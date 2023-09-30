import crypto from 'node:crypto';

import AccountService from "../account/account-service.js";
import EventBus, { EmitMeta } from "../cluster/eventbus.js";
import ClusterService from "../cluster/index.js";
import { Logger } from "../logger.js";
import Storage from "../storage/index.js";
import { TunnelConfig, TunnelIngressConfig, cloneTunnelConfig  } from "./tunnel-config.js";
import { Tunnel, TunnelConnection, TunnelConnectionId, TunnelState } from "./tunnel.js";
import Account from '../account/account.js';
import Ingress from '../ingress/index.js';
import { safeEqual } from '../utils/misc.js';
import { Duplex } from 'node:stream';
import Transport from '../transport/transport.js';
import Node from '../cluster/cluster-node.js';
import ClusterTransport from '../transport/cluster/cluster-transport.js';

export type ConnectOptions = {
    peer: string,
}

export type CreateConnectionContext = {
    ingress: {
        port: number,
        tls?: boolean,
    }
};

type AuthorizeResult = {
    authorized: boolean,
    disabled: boolean,
    tunnel?: Tunnel,
    account?: Account,
    error?: Error,
};

type TunnelListResult = {
    cursor: string | null,
    tunnels: Array<Tunnel>,
};

interface TunnelConnectionAnnounce {
    connection_id: string,
    node: string,
    peer: string,
    connected: boolean,
    connected_at?: number,
    disconnected_at?: number,
};

interface TunnelAnnounce {
    tunnel_id: string;
    connections: Array<TunnelConnectionAnnounce>;
}

interface TunnelDisconnectRequest {
    tunnel_id: string;
}

export default class TunnelService {

    static TUNNEL_ID_REGEX = /^(?:[a-z0-9][a-z0-9\-]{4,63}[a-z0-9]|[a-z0-9]{4,63})$/;

    static instance?: TunnelService;
    static ref: number;

    private tunnelAnnounceInterval: number = 5000;
    private tunnelAnnounceBatchSize: number = 50;
    private stateRefreshInterval: number = 10000;

    private tunnelConnectionAliveThreshold: number = 15000;
    private tunnelConnectionRemoveThreshold: number = 60000;
    private tunnelRemoveThreshold: number = 60000 * 5;

    private announceTimer: NodeJS.Timeout | undefined;
    private stateRefreshTimer: NodeJS.Timeout | undefined;

    private ended: boolean = false;
    private destroyed: boolean = false;
    private logger: any;
    private storage!: Storage;
    private ingress!: Ingress;
    private eventBus!: EventBus;
    private clusterService!: ClusterService;
    private accountService!: AccountService;

    private connectedTunnels!: { [ id: string ]: TunnelState };
    private lastConnection!: { [ id: string]: string };

    constructor() {
        if (TunnelService.instance instanceof TunnelService) {
            TunnelService.ref++;
            return TunnelService.instance;
        }
        TunnelService.ref = 1;
        TunnelService.instance = this;

        this.logger = Logger("tunnel-service");
        this.storage = new Storage("tunnel");
        this.ingress = new Ingress();
        this.eventBus = new EventBus();
        this.clusterService = new ClusterService();
        this.accountService = new AccountService();

        this.connectedTunnels = {}
        this.lastConnection = {};

        this.eventBus.on('tunnel:announce', (announcement: Array<TunnelAnnounce>, meta: EmitMeta) => {
            this.learnRemoteTunnels(announcement, meta);
        });

        this.eventBus.on('tunnel:disconnect', async (request: TunnelDisconnectRequest) => {
            await this.disconnectLocalTunnel(request.tunnel_id);
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
    }

    public async destroy(): Promise<void> {
        if (this.destroyed) {
            return;
        }

        if (--TunnelService.ref == 0) {
            await this.end();

            clearTimeout(this.announceTimer);
            this.announceTimer = undefined;

            clearTimeout(this.stateRefreshTimer);
            this.stateRefreshTimer = undefined;

            this.destroyed = true
            await Promise.allSettled([
                this.storage.destroy(),
                this.eventBus.destroy(),
                this.clusterService.destroy(),
                this.accountService.destroy(),
                this.ingress.destroy(),
            ]);
            TunnelService.instance = undefined;
        }
    }

    public async end(): Promise<void> {
        const results = Object.keys(this.connectedTunnels).map((tunnelId: string) => this.disconnectLocalTunnel(tunnelId))
        await Promise.allSettled(results);
        this.ended = true;
    }

    private async announceLocalTunnels(): Promise<void>;
    private async announceLocalTunnels(tunnelIds: Array<string>): Promise<void>;
    private async announceLocalTunnels(tunnelIds?: Array<string>): Promise<void> {

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

    private learnRemoteTunnels(tunnels: Array<TunnelAnnounce>, meta: EmitMeta): void {
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

    private refreshConnectionState(): void {
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

    private async disconnectLocalTunnel(tunnelId: string, connectionId?: string): Promise<void> {
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

    private async _get(tunnelId: string): Promise<Tunnel>;
    private async _get(tunnelIds: Array<string>): Promise<Array<Tunnel>>;
    private async _get(tunnelIds: any): Promise<any> {
        const tunnelConfig = await this.storage.read(tunnelIds, TunnelConfig);
        if (tunnelConfig instanceof Array) {
            return tunnelConfig.map((tc: TunnelConfig) => {
                const state = this.connectedTunnels[tc.id];
                return new Tunnel(tc, state);
            });

        } else if (tunnelConfig instanceof TunnelConfig) {
            const state = this.connectedTunnels[tunnelConfig.id];
            return new Tunnel(tunnelConfig, state);
        } else {
            if (tunnelIds instanceof Array) {
                return [];
            } else {
                throw Error('no_such_tunnel');
            }
        }
    }

    private _isPermitted(tunnel: Tunnel, accountId: string): boolean {
        return accountId != undefined && accountId === tunnel.config.account;
    }

    public async create(tunnelId: string, accountId: string): Promise<Tunnel> {
        const tunnelConfig = new TunnelConfig(tunnelId, accountId);
        tunnelConfig.created_at = new Date().toISOString();
        tunnelConfig.updated_at = tunnelConfig.created_at;
        tunnelConfig.transport.token = crypto.randomBytes(64).toString('base64url');

        const created: boolean = await this.storage.create(tunnelId, tunnelConfig);
        if (!created) {
            throw Error("could_not_create_tunnel");
        }

        await this.accountService.update(accountId, (account: Account) => {
            if (!account.tunnels.includes(tunnelId)) {
                account.tunnels.push(tunnelId);
            }
        });

        this.logger
            .withContext('tunnel', tunnelId)
            .debug({
                message: `tunnel ${tunnelId} created`,
                operation: 'create_tunnel',
            });

        return this._get(tunnelId);
    }

    public async delete(tunnelId: string, accountId: string): Promise<boolean> {
        const tunnel = await this._get(tunnelId);
        if (!this._isPermitted(tunnel, accountId)) {
            throw Error("permission_denied")
        }

        //TODO disable tunnel
        try {
            const disconnected = await this.disconnect(tunnelId, accountId);
            if (!disconnected) {
                this.logger
                    .withContext('tunnel', tunnelId)
                    .warn({
                        message: `tunnel not disconnected, deleting anyway`,
                        operation: 'delete_tunnel',
                    });
            }
        } catch (e: any) {
            this.logger
                .withContext('tunnel', tunnelId)
                .error({
                    message: `failed to disconnect tunnel: ${e.message}`,
                    operation: 'delete_tunnel',
                    stack: `${e.stack}`,
                });
        }

        const updateAccount = this.accountService.update(accountId, (account: Account) => {
            const pos = account.tunnels.indexOf(tunnelId);
            if (pos >= 0) {
                account.tunnels.splice(pos, 1);
            }
        });

        try {
            await Promise.all([
                this.ingress.deleteIngress(tunnel.config),
                this.storage.delete(<any>tunnelId),
                updateAccount,
            ]);
        } catch (e: any) {
            this.logger
                .withContext('tunnel', tunnelId)
                .error({
                    message: `failed to delete tunnel: ${e.message}`,
                    operation: 'delete_tunnel',
                    stack: `${e.stack}`,
                });
            return false;
        }
        this.logger
            .withContext('tunnel', tunnelId)
            .debug({
                message: `tunnel ${tunnelId} deleted`,
                operation: 'delete_tunnel',
            });
        return true;
    }

    public async update(tunnelId: string, accountId: string, callback: (tunnelConfig: TunnelConfig) => void): Promise<Tunnel> {
        let tunnel = await this._get(tunnelId);
        if (!this._isPermitted(tunnel, accountId)) {
            throw new Error('permission_denied');
        }

        const updatedConfig = await this.storage.update(tunnelId, TunnelConfig, async (tunnelConfig: TunnelConfig) => {

            const origConfig = cloneTunnelConfig(tunnelConfig);
            callback(tunnelConfig);

            const updatedIngress = await this.ingress.updateIngress(tunnelConfig, origConfig);
            if (updatedIngress instanceof Error) {
                const err = updatedIngress;
                this.logger.isDebugEnabled() &&
                    this.logger
                        .withContext('tunnel', tunnelId)
                        .debug({
                            message: 'update ingress failed',
                            operation: 'update_tunnel',
                            err: err.message,
                        });
                throw err;
            }
            tunnelConfig.ingress = <TunnelIngressConfig>updatedIngress;
            tunnelConfig.updated_at = new Date().toISOString();

            return true;
        });
        tunnel.config = updatedConfig;
        return tunnel;
    }

    public async list(cursor: string | undefined, count: number = 10, verbose: boolean = false): Promise<TunnelListResult> {
        const res = await this.storage.list(<any>cursor, count);

        const data: Array<Tunnel> = verbose ? await this._get(res.data) : res.data.map((id: string) => {
            return new Tunnel(new TunnelConfig(id, <any>undefined), undefined)
        });
        return {
            cursor: res.cursor,
            tunnels: data,
        }
    }

    public async get(tunnelId: string, accountId: string): Promise<Tunnel> {
        const tunnel = await this._get(tunnelId);
        if (!this._isPermitted(tunnel, accountId)) {
            throw Error("permission_denied")
        }
        return tunnel;
    }

    public async lookup(tunnelId: string): Promise<Tunnel> {
        return this._get(tunnelId);
    }

    public async authorize(tunnelId: string, token: string): Promise<AuthorizeResult> {
        const result: AuthorizeResult = {
            authorized: false,
            disabled: false,
            tunnel: undefined,
            account: undefined,
            error: undefined,
        };

        try {
            const tunnel = await this._get(tunnelId);
            const account = await this.accountService.get(tunnel.config.account);
            if (!(account instanceof Account)) {
                return result;
            }
            const correctToken = safeEqual(token, tunnel.config.transport.token)

            result.authorized = correctToken && !account.status.disabled;
            if (result.authorized) {
                result.tunnel = tunnel;
                result.account = account;
                result.disabled = account.status.disabled;
            }
        } catch (e: any) {
            result.error = e;
        }

        return result;
    }

    public async connect(tunnelId: string, accountId: string, transport: Transport, opts: ConnectOptions): Promise<boolean> {
        if (this.ended) {
            return false;
        }

        let tunnel = await this._get(tunnelId);
        if (!this._isPermitted(tunnel, accountId)) {
            return false;
        }

        if (tunnel.state.alive_connections >= transport.max_connections) {
            this.logger
                .withContext('tunnel',tunnelId)
                .info({
                    message: `Refused transport connection, current connections ${tunnel.state.connections.length}, max connections ${transport.max_connections}`,
                    operation: 'connect_tunnel',
                    connections: tunnel.state.alive_connections,
                    max_connections: transport.max_connections,
                });
            return false;
        }

        const connection: TunnelConnection = {
            connection_id: `${Node.identifier}:${crypto.randomUUID()}`,
            transport,
            node: Node.identifier,
            peer: opts.peer,
            local: true,
            connected: true,
            connected_at: Date.now(),
            alive_at: Date.now(),
        };

        this.addTunnelConnection(tunnel, connection);

        transport.once('close', () => {
            this.disconnectLocalTunnel(tunnelId, connection.connection_id);
        });
        await this.announceLocalTunnels([tunnelId]);

        tunnel = await this.update(tunnelId, accountId, (tunnelConfig) => {
            tunnelConfig.transport.token = crypto.randomBytes(64).toString('base64url');
        });

        this.logger
            .withContext('tunnel',tunnelId)
            .debug({
                message: `Tunnel transport connected, peer ${opts.peer}`,
                operation: 'connect_tunnel',
                connections: tunnel.state.alive_connections,
                max_connections: transport.max_connections,
            });
        return true;
    }

    public async disconnect(tunnelId: string, accountId: string): Promise<boolean> {
        let tunnel = await this._get(tunnelId);
        if (!this._isPermitted(tunnel, accountId)) {
            return false;
        }

        const alive_connections = tunnel.state.connections
            .filter((con) => con.connected);

        const announces = alive_connections.map((con) => {
            return this.eventBus.waitFor('tunnel:announce', (announces: Array<TunnelAnnounce>, meta: EmitMeta) => {
                return announces.filter((announce) => announce.tunnel_id == tunnelId).length > 0
            }, 500);
        });

        const tunnelDisconnect: TunnelDisconnectRequest = {
            tunnel_id: tunnelId
        };
        this.eventBus.publish('tunnel:disconnect', tunnelDisconnect);

        const res = await Promise.allSettled(announces);
        tunnel = await this._get(tunnelId);

        this.logger
            .withContext('tunnel',tunnelId)
            .debug({
                message: `Tunnel disconnection result, disconnected=${!tunnel.state.connected}`,
                operation: 'disconnect_tunnel',
                connections: tunnel.state.alive_connections,
            });

        return !tunnel.state.connected;
    }

    private addTunnelConnection(tunnel: Tunnel, connection: TunnelConnection): void {
        this.connectedTunnels[tunnel.id] ??= {
            connected: false,
            alive_connections: 0,
            connections: [],
        }

        const connections = this.connectedTunnels[tunnel.id].connections;
        connections.push(connection);
        this.connectedTunnels[tunnel.id].connections = connections;
        this.updateTunnelState(tunnel);
    }

    private updateTunnelState(tunnel: Tunnel): boolean;
    private updateTunnelState(tunnelId: string): boolean;
    private updateTunnelState(tunnel: any): boolean {
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

    private getNextConnection(tunnelId: string): TunnelConnection | undefined {
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

    public createConnection(tunnelId: string, ctx: CreateConnectionContext, callback: (err: Error | undefined, sock: Duplex) => void): Duplex {
        const connection = this.getNextConnection(tunnelId);
        if (!connection?.transport) {
            callback(new Error('no_transport'), <any>undefined);
            return <any>undefined;
        }
        const sock = connection.transport.createConnection({
            tunnelId,
            port: ctx.ingress.port,
        }, callback);
        return sock;
    }

    public isLocalConnected(tunnelId: string): boolean {
        const state = this.connectedTunnels[tunnelId];
        if (!state) {
            return false;
        }
        return state.connections.filter((con) => con.connected && con.local).length > 0;
    }
}
