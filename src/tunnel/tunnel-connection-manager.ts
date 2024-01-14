import EventBus, { EmitMeta } from "../cluster/eventbus.js";
import Tunnel, { TunnelState, TunnelConnection } from "./tunnel.js";
import Node from '../cluster/cluster-node.js';
import ClusterTransport from "../transport/cluster/cluster-transport.js";
import { Duplex } from "stream";

export type ConnectOptions = {
    peer: string,
}

type CreateConnectionIngressTlsContext = {
    enabled: boolean,
    servername?: string,
    cert?: Buffer,
};

export type CreateConnectionContext = {
    remoteAddr: string,
    ingress: {
        port: number,
        tls?: CreateConnectionIngressTlsContext,
    }
};

interface TunnelConnectionAnnounce {
    connection_id: string,
    node: string,
    peer: string,
    connected: boolean,
    connected_at?: number,
    disconnected_at?: number,
};

export interface TunnelAnnounce {
    tunnel_id: string;
    connections: Array<TunnelConnectionAnnounce>;
}

export interface TunnelDisconnectRequest {
    tunnel_id: string;
}

export default class TunnelConnectionManager {
    private static running: boolean = false;
    public static ready: boolean = false;

    private static tunnelAnnounceInterval: number = 5000;
    private static tunnelAnnounceBatchSize: number = 50;
    private static stateRefreshInterval: number = 10000;

    private static tunnelConnectionAliveThreshold: number = 15000;
    private static tunnelConnectionRemoveThreshold: number = 60000;
    private static tunnelRemoveThreshold: number = 60000 * 5;

    private static announceTimer: NodeJS.Timeout | undefined;
    private static stateRefreshTimer: NodeJS.Timeout | undefined;

    private static connectedTunnels: { [ id: string ]: TunnelState } = {};
    private static lastConnection: { [ id: string]: string } = {};
    private static eventBus: EventBus;

    public static async start(): Promise<void> {
        if (this.running) {
            return;
        }
        this.running = true;
        this.eventBus = new EventBus();

        this.eventBus.on('tunnel:announce', (announcement: Array<TunnelAnnounce>, meta: EmitMeta) => {
            this.learnRemoteTunnels(announcement, meta);
        });

        this.eventBus.on('tunnel:disconnect', async (request: TunnelDisconnectRequest) => {
            await this.disconnectTunnel(request.tunnel_id);
        });

        const announceTunnels = async () => {
            await this.announceLocalTunnels();
            this.announceTimer = setTimeout(announceTunnels, this.tunnelAnnounceInterval);
        };
        this.announceTimer = setTimeout(announceTunnels, this.tunnelAnnounceInterval);

        const refreshState = () => {
            this.refreshConnectionState();
            this.stateRefreshTimer = setTimeout(refreshState, this.stateRefreshInterval);
        };
        this.stateRefreshTimer = setTimeout(refreshState, this.stateRefreshInterval);
        this.ready = true;
    }

    public static async stop(): Promise<void> {
        this.ready = false;
        const results = Object.keys(this.connectedTunnels).map((tunnelId: string) => this.disconnectTunnel(tunnelId))
        await Promise.allSettled(results);

        clearTimeout(this.announceTimer);
        this.announceTimer = undefined;

        clearTimeout(this.stateRefreshTimer);
        this.stateRefreshTimer = undefined;

        this.eventBus?.removeAllListeners();
        await this.eventBus?.destroy();
        (<any>this.eventBus) = undefined;
        this.lastConnection = {};
        this.connectedTunnels = {};
        this.running = false;
    }

    private static async disconnectTunnel(tunnelId: string): Promise<void> {
        return this._removeTunnelConnection(tunnelId);
    }

    public static async removeTunnelConnection(tunnelId: string, connectionId: string): Promise<void> {
        return this._removeTunnelConnection(tunnelId, connectionId);
    }

    private static async _removeTunnelConnection(tunnelId: string, connectionId?: string): Promise<void> {
        const state = this.connectedTunnels[tunnelId];
        if (!state) {
            return;
        }

        for (const con of state.connections.filter((tc) => connectionId == undefined || tc.connection_id == connectionId)) {
            if (!con.local) {
                continue;
            }
            await con.transport?.destroy();
            con.transport = undefined;
            con.disconnected_at = Date.now();
            con.connected = false;
        }
        if (this.updateTunnelState(tunnelId)) {
            this.announceLocalTunnels([tunnelId]);
        }
    }

    public static async addTunnelConnection(tunnel: Tunnel, connection: TunnelConnection): Promise<void> {
        this.connectedTunnels[<string>tunnel.id] ??= {
            connected: false,
            alive_connections: 0,
            connections: [],
        }

        const connections = this.connectedTunnels[<string>tunnel.id].connections;
        connections.push(connection);
        this.connectedTunnels[<string>tunnel.id].connections = connections;
        this.updateTunnelState(tunnel);
        await this.announceLocalTunnels([<string>tunnel.id]);
    }

    public static createConnection(tunnelId: string, ctx: CreateConnectionContext, callback: (err: Error | undefined, sock: Duplex) => void): Duplex {
        const connection = this.getNextConnection(tunnelId);
        if (!connection?.transport) {
            callback(new Error('no_transport'), <any>undefined);
            return <any>undefined;
        }
        const sock = connection.transport.createConnection({
            tunnelId,
            remoteAddr: ctx.remoteAddr,
            port: ctx.ingress.port,
            tls: {
                enabled: ctx.ingress.tls?.enabled == true,
                servername: ctx.ingress.tls?.servername,
                cert: ctx.ingress.tls?.cert,
            }
        }, callback);
        return sock;
    }

    public static getConnectedState(tunnelId: string): TunnelState | undefined {
        const state = this.connectedTunnels[tunnelId];
        return state;
    }

    public static isLocalConnected(tunnelId: string): boolean {
        const state = this.connectedTunnels[tunnelId];
        if (!state) {
            return false;
        }
        return state.connections.filter((con) => con.connected && con.local).length > 0;
    }

    private static async announceLocalTunnels(): Promise<void>;
    private static async announceLocalTunnels(tunnelIds: Array<string>): Promise<void>;
    private static async announceLocalTunnels(tunnelIds?: Array<string>): Promise<void> {

        if (tunnelIds == undefined) {
            tunnelIds = Object.keys(this.connectedTunnels).filter((tunnelId: string) => {
                const state = this.connectedTunnels[tunnelId];
                return state.connections.filter((con) => con.local).length > 0;
            });
        }

        const _tunnelIds: Array<string> = tunnelIds;
        const batchsize = this.tunnelAnnounceBatchSize;

        return new Promise((resolve) => {
            const processChunk = async () => {
                const chunk = _tunnelIds.splice(0, batchsize);

                const tunnels: Array<TunnelAnnounce> = chunk.map((tunnelId) => {
                    const state = this.connectedTunnels[tunnelId];

                    const localConnections: Array<TunnelConnectionAnnounce> = state.connections
                        .filter((con) => con.local)
                        .map((con) => {
                            return {
                                connection_id: con.connection_id,
                                node: con.node,
                                peer: con.peer,
                                connected: con.connected,
                                connected_at: con.connected_at,
                                disconnected_at: con.disconnected_at,
                            }
                    });

                    return {
                        tunnel_id: tunnelId,
                        connections: localConnections,
                    }
                });

                await this.eventBus.publish("tunnel:announce", tunnels);
                if (_tunnelIds.length > 0) {
                    setImmediate(processChunk);
                } else {
                    resolve();
                }
            };

            if (_tunnelIds.length > 0) {
                setImmediate(processChunk);
            } else {
                resolve();
            }
        });
    }

    private static learnRemoteTunnels(tunnels: Array<TunnelAnnounce>, meta: EmitMeta): void {
        const nodeId = meta.node.id;
        if (nodeId == Node.identifier) {
            return;
        }

        for (const tunnel of tunnels) {
            this.connectedTunnels[tunnel.tunnel_id] ??= {
                connected: false,
                alive_connections: 0,
                connections: [],
            }

            const state = this.connectedTunnels[tunnel.tunnel_id];
            state.connections = state.connections.filter((con) => con.node != nodeId);

            const connections: Array<TunnelConnection> = tunnel.connections.map((con) => {
                const transport = con.connected ?  new ClusterTransport({nodeId}) : undefined;
                return {
                    connection_id: con.connection_id,
                    node: con.node,
                    peer: con.peer,
                    connected: con.connected,
                    connected_at: con.connected_at,
                    disconnected_at: con.disconnected_at,
                    alive_at: Date.now(),
                    local: false,
                    transport,
                }
            });

            this.connectedTunnels[tunnel.tunnel_id].connections = state.connections.concat(connections);
            this.updateTunnelState(tunnel.tunnel_id);
        }
    }

    private static refreshConnectionState(): void {
        const cur = Date.now();

        for (const tunnelId in this.connectedTunnels) {
            const state = this.connectedTunnels[tunnelId];

            // Mark remote connections that have an alive_at timestamp
            // exceeding the connection alive threshold as disconnected.
            state.connections = state.connections.map((con) => {
                if (!con.local && con.connected && (cur - con.alive_at) > this.tunnelConnectionAliveThreshold) {
                    con.connected = false;
                    con.disconnected_at = cur;
                }
                return con;
            });

            // Keep connections that are connected or disconnected
            // but within the connection removal threshold.
            const connections = [];
            for (const con of state.connections) {
                if (con.connected) {
                    connections.push(con);
                    continue;
                }
                else if (con.disconnected_at && ((cur - con.disconnected_at) < this.tunnelConnectionRemoveThreshold)) {
                    connections.push(con);
                    continue;
                }
                con.transport?.destroy();
                con.transport = undefined;
            }

            this.connectedTunnels[tunnelId].connections = connections;
            this.updateTunnelState(tunnelId);

            if (!state.connected &&
                state.connections.length == 0 &&
                (!state.disconnected_at || (cur - <number>state.disconnected_at) > this.tunnelRemoveThreshold)) {
                    delete this.connectedTunnels[tunnelId];
                    delete this.lastConnection[tunnelId]
            }
        }
    }

    private static updateTunnelState(tunnel: Tunnel): boolean;
    private static updateTunnelState(tunnelId: string): boolean;
    private static updateTunnelState(tunnel: any): boolean {
        const tunnelId = tunnel instanceof Tunnel ? tunnel.id : tunnel;
        let state = this.connectedTunnels[tunnelId];
        if (!state) {
            return false;
        }

        const alive_connections = state.connections.filter((tc) => tc.connected).length;
        const connected = alive_connections > 0;

        if (connected && !state.connected) {
            state.connected_at = state.connections
                .filter((con) => con.connected && con.connected_at)
                .sort((a, b) => <number>a.connected_at - <number>b.connected_at)[0]?.connected_at || Date.now();
        } else if (!connected && state.connected) {
            state.disconnected_at = state.connections
                .filter((con) => !con.connected && con.disconnected_at)
                .sort((b, a) => <number>a.disconnected_at - <number>b.disconnected_at)[0]?.disconnected_at || Date.now();
        }

        const changed = connected != state.connected ||
            alive_connections != state.alive_connections;

        state.connected = connected;
        state.alive_connections = alive_connections;
        if (connected) {
            state.alive_at = Date.now();
        }

        this.connectedTunnels[tunnelId] = state;
        return changed;
    }

    private static getNextConnection(tunnelId: string): TunnelConnection | undefined {
        const state = this.connectedTunnels[tunnelId];
        if (!state) {
            return undefined;
        }

        const lastConnectionId = this.lastConnection[tunnelId];

        const localConnections = state.connections
            .filter((con) => con.connected && con.local)
            .sort((a, b) => a.connection_id.localeCompare(b.connection_id));
        if (localConnections.length > 0) {
            let i = 0;
            for (; i < localConnections.length; i++) {
                if (localConnections[i].connection_id == lastConnectionId) {
                    i++;
                    break;
                }
            }
            i = i % localConnections.length;
            this.lastConnection[tunnelId] = localConnections[i].connection_id;
            return localConnections[i];
        }

        const remoteConnections = state.connections
            .filter((con) => con.connected && !con.local)
            .sort((a, b) => a.connection_id.localeCompare(b.connection_id));
        if (remoteConnections.length > 0) {
            let i = 0;
            for (; i < remoteConnections.length; i++) {
                if (remoteConnections[i].connection_id == lastConnectionId) {
                    i++;
                    break;
                }
            }
            i = i % remoteConnections.length;
            this.lastConnection[tunnelId] = remoteConnections[i].connection_id;
            return remoteConnections[i];
        }

        return undefined;
    }
}