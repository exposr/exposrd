import assert from 'assert/strict';
import crypto from 'crypto';
import AccountService from '../account/account-service.js';
import Account from '../account/account.js';
import EventBus from '../cluster/eventbus.js';
import ClusterService from '../cluster/index.js';
import Ingress from '../ingress/index.js';
import { Logger } from '../logger.js';
import Storage from '../storage/index.js';
import NodeSocket from '../transport/node-socket.js';
import { safeEqual } from "../utils/misc.js";
import TunnelState from './tunnel-state.js';
import Tunnel from './tunnel.js';
import Node from '../cluster/cluster-node.js';

class TunnelService {

    static TUNNEL_ID_REGEX = /^(?:[a-z0-9][a-z0-9\-]{4,63}[a-z0-9]|[a-z0-9]{4,63})$/;

    constructor() {
        if (TunnelService.instance instanceof TunnelService) {
            TunnelService.ref++;
            return TunnelService.instance;
        }
        TunnelService.ref = 1;
        TunnelService.instance = this;

        this.tunnelAnnounceInterval = 5000;
        this.tunnelAnnounceBatchSize = 50;
        this.tunnelConnectionAliveThreshold = 15000;
        this.tunnelDeadSweepInterval = 1000;
        this.tunnelConnectionDeleteThreshold = 300 * 1000;
        this.tunnelDeleteSweepInterval = 60 * 1000;

        this.logger = Logger("tunnel-service");
        this._accountService = new AccountService();
        this._db = new Storage("tunnel");
        this._eventBus = new EventBus();
        this._clusterService = new ClusterService();
        this._ingress = new Ingress();

        this._connectedTunnels = {};

        this._tunnels = {
            state: {
                tunnels: {}
            },

            learn: (tunnelId, connections, meta) => {
                const state = this._tunnels.state;

                state.tunnels[tunnelId] ??= {
                    connections: {},
                    lastCon: undefined,
                    connected: false,
                    markSweep: setInterval(() => {
                        this._tunnels._markDeadConnections(tunnelId)
                    }, this.tunnelDeadSweepInterval),
                    deleteSweep: setInterval(() => {
                        this._tunnels._deleteDeadConnections(tunnelId)
                    }, this.tunnelDeleteSweepInterval)
                };

                const tunnel = state.tunnels[tunnelId];
                const cids = Array.from(new Set([
                    ...Object.keys(tunnel.connections).filter((cid) => tunnel.connections[cid].node == meta.node.id),
                    ...Object.keys(connections)
                ]));

                cids.forEach((cid) => {
                    const con = connections[cid];
                    if (con) {
                        tunnel.connections[con.id] = {
                            ...con,
                            node: meta.node.id,
                            alive_at: meta.ts,
                            alive: true,
                            local: this._connectedTunnels[tunnelId]?.connections?.[con.id] != undefined,
                        };
                    } else {
                        tunnel.connections[cid].alive = false;
                        tunnel.connections[cid].dead_at = meta.ts;
                    }
                });

                this._tunnels._updateConnectionState(tunnelId, meta.ts);
            },

            _updateConnectionState: (tunnelId, ts) => {
                const tunnel = this._tunnels.state.tunnels[tunnelId];
                const was_connected = tunnel.connected;

                tunnel.connected_at = Object.keys(tunnel.connections).map((cid) => tunnel.connections[cid].connected_at).sort()[0];
                tunnel.connected = Object.keys(tunnel.connections).filter((cid) => tunnel.connections[cid].alive == true).length > 0;
                tunnel.alive_at = Object.keys(tunnel.connections).map((cid) => tunnel.connections[cid].alive_at).sort((a, b) => b - a)[0];

                if (!tunnel.connected && was_connected) {
                    tunnel.disconnected_at = ts;
                } else if (tunnel.connected) {
                    tunnel.disconnected_at = undefined;
                }
            },

            _markDeadConnections: (tunnelId) => {
                const tunnel = this._tunnels.state.tunnels[tunnelId];
                if (!tunnel) {
                    return;
                }

                const current_ts = Date.now();
                Object.keys(tunnel.connections).forEach((cid) => {
                    const con = tunnel.connections[cid];
                    if (con.alive && (con.alive_at + this.tunnelConnectionAliveThreshold) < current_ts) {
                        con.alive = false;
                        con.dead_at = current_ts;
                    }
                });
                this._tunnels._updateConnectionState(tunnelId, current_ts);
            },

            _deleteDeadConnections: (tunnelId) => {
                const tunnel = this._tunnels.state.tunnels[tunnelId];
                if (!tunnel) {
                    return;
                }

                const current_ts = Date.now();
                const dead_thres = this.tunnelConnectionDeleteThreshold;
                Object.keys(tunnel.connections).forEach((cid) => {
                    const con = tunnel.connections[cid];
                    if (!con.alive && (current_ts > (con.dead_at + dead_thres))) {
                        delete tunnel.connections[cid];
                    }
                });

                if (Object.keys(tunnel.connections) == 0) {
                    clearTimeout(tunnel.markSweep);
                    clearTimeout(tunnel.deleteSweep);
                    delete this._tunnels.state[tunnelId];
                }
            },

            get: (tunnelId) => {
                const tunnel = this._tunnels.state.tunnels[tunnelId];
                return tunnel;
            },

            getState: (tunnelId) => {
                const tunnel = this._tunnels.state.tunnels[tunnelId];
                const tunnelState = new TunnelState();
                if (!tunnel) {
                    return tunnelState;
                }

                tunnelState.connected = tunnel.connected;
                tunnelState.connected_at = tunnel.connected_at ? new Date(tunnel.connected_at).toISOString() : undefined,
                tunnelState.disconnected_at = tunnel.disconnected_at ? new Date(tunnel.disconnected_at).toISOString() : undefined;
                tunnelState.alive_at = tunnel.alive_at ? new Date(tunnel.alive_at).toISOString() : undefined;
                tunnelState.connections = Object.keys(tunnel.connections)
                    .map(cid => tunnel.connections[cid])
                    .filter(con => con.alive)
                    .map((con => {
                        return {
                            connection_id: con.id,
                            node_id: con.node,
                            peer: con.peer,
                            alive_at: con.alive_at ? new Date(con.alive_at).toISOString() : undefined,
                            connected_at: con.connected_at ? new Date(con.connected_at).toISOString() : undefined,
                        }
                    }));

                return tunnelState;
            },

            getNextConnection: (tunnelId) => {
                const tunnel = this._tunnels.state.tunnels[tunnelId];
                if (!tunnel) {
                    return undefined;
                }

                const localCons = Object.keys(this._connectedTunnels[tunnelId]?.connections || {});
                if (localCons.length > 0) {
                    const idx = (localCons.indexOf(tunnel.lastCon) + 1) % localCons.length;
                    const nextCon = localCons[idx];
                    tunnel.lastCon = nextCon;
                    return {
                        cid: nextCon,
                        local: true,
                    }
                } else {
                    const remoteNodes = Array.from(new Set(Object.keys(tunnel.connections).filter((cid) => {
                        const con = tunnel.connections[cid];
                        return con.alive && !con.local;
                    })
                    .map((cid) => {
                        const con = tunnel.connections[cid];
                        return con.node;
                    })));

                    const idx = (remoteNodes.indexOf(tunnel.lastCon) + 1) % remoteNodes.length;
                    const nextNode = remoteNodes[idx];
                    tunnel.lastCon = nextNode;
                    return {
                        node: nextNode,
                        local: false,
                    }
                }
            },
        };

        this._eventBus.on('tunnel:announce', (state, meta) => {
            const tunnelIds = Object.keys(state);
            tunnelIds.forEach((tunnelId) => {
                setImmediate(() => {
                    const tunnel = state[tunnelId];
                    this._tunnels.learn(tunnelId, tunnel.connections, meta)
                });
            });
        });

        this._eventBus.on('tunnel:disconnect', (message, meta) => {
            const tunnelId = message?.tunnel;
            if (!tunnelId) {
                return;
            }
            this._closeTunnelConnection(tunnelId, message.connection);
        });

        const announceTunnels = async () => {
            await this._announceTunnels();
            this._announceTimer = setTimeout(announceTunnels, this.tunnelAnnounceInterval);
        };
        this._announceTimer = setTimeout(announceTunnels, this.tunnelAnnounceInterval);
    }

    async destroy() {
        if (--TunnelService.ref == 0) {
            this.destroyed = true;
            clearTimeout(this._announceTimer);
            const tunnels = Object.keys(this._connectedTunnels).map(async (tunnelId) => {
                const tunnel = await this.lookup(tunnelId);
                return this._disconnect(tunnel);
            });
            await Promise.allSettled(tunnels);
            await Promise.allSettled([
                this._db.destroy(),
                this._clusterService.destroy(),
                this._eventBus.destroy(),
                this._accountService.destroy(),
                this._ingress.destroy(),
            ]);
            delete TunnelService.instance;
        }
    }

    _isPermitted(tunnel, accountId) {
        if (!(tunnel instanceof Tunnel)) {
            return false;
        }
        return tunnel.isOwner(accountId);
    }

    async _get(tunnelId) {
        assert(tunnelId != undefined);

        const tunnel = await this._db.read(tunnelId, Tunnel);
        if (tunnel instanceof Array) {
            Promise.allSettled(tunnel.map((t) => {
                return new Promise(async (resolve) => {
                    t._state = this._tunnels.getState(t);
                    resolve();
                });
            }));
        } else if (tunnel instanceof Tunnel) {
            tunnel._state = this._tunnels.getState(tunnelId);
        } else {
            return false;
        }

        return tunnel;
    }

    async get(tunnelId, accountId) {
        assert(tunnelId != undefined);
        assert(accountId != undefined);

        if (this.destroyed) {
            return false;
        }

        const tunnel = await this._get(tunnelId);
        if (!this._isPermitted(tunnel, accountId)) {
            return false;
        }

        this.logger.isDebugEnabled() && this.logger.debug({
            operation: 'get_tunnel',
            tunnel: tunnel.id,
            account: tunnel.account,
        });
        return tunnel;
    }

    async lookup(tunnelId) {
        return this._get(tunnelId);
    }

    async list(cursor, count = 10, verbose = false) {
        const res = await this._db.list(cursor, count);
        const data = verbose ? await this._get(res.data) : res.data.map((id) => { return {tunnel_id: id}; });
        return {
            cursor: res.cursor,
            tunnels: data,
        }
    }

    async create(tunnelId, accountId) {
        assert(tunnelId != undefined);
        assert(accountId != undefined);

        const tunnel = new Tunnel(tunnelId, accountId);
        tunnel.created_at = new Date().toISOString();
        tunnel.updated_at = tunnel.created_at;
        tunnel.transport.token = crypto.randomBytes(64).toString('base64url');
        const created = await this._db.create(tunnelId, tunnel);
        if (!created) {
            return false;
        }

        await this._accountService.update(accountId, (account) => {
            if (!account.tunnels.includes(tunnelId)) {
                account.tunnels.push(tunnelId);
            }
        });

        this.logger.isDebugEnabled() && this.logger.debug({
            operation: 'create_tunnel',
            tunnel: tunnel.id,
            account: tunnel.account,
        });
        return created;
    }

    async update(tunnelId, accountId, cb) {
        assert(tunnelId != undefined);
        assert(accountId != undefined);
        return this._db.update(tunnelId, Tunnel, async (tunnel) => {
            if (!this._isPermitted(tunnel, accountId)) {
                return false;
            }

            const orig = tunnel.clone();
            cb(tunnel);

            const updatedIngress = await this._ingress.updateIngress(tunnel, orig);
            if (updatedIngress instanceof Error) {
                const err = updatedIngress;
                this.logger.isDebugEnabled() &&
                    this.logger
                        .withContext('tunnel', tunnelId)
                        .debug({
                            operation: 'update_tunnel',
                            msg: 'update ingress failed',
                            err: err.message,
                        });
                return err;
            }
            tunnel.ingress = updatedIngress;
            tunnel.updated_at = new Date().toISOString();

            return true;
        });
    }

    async delete(tunnelId, accountId) {
        assert(tunnelId != undefined);
        assert(accountId != undefined);

        const tunnel = await this.get(tunnelId, accountId);
        if (tunnel instanceof Tunnel == false) {
            return false;
        }
        if (!await this.disconnect(tunnelId, accountId)) {
            this.logger
                .withContext('tunnel', tunnelId)
                .error({
                    operation: 'delete_tunnel',
                    msg: 'tunnel still connected'
                });
            return false;
        };

        const updateAccount = this._accountService.update(accountId, (account) => {
            const pos = account.tunnels.indexOf(tunnelId);
            if (pos >= 0) {
                account.tunnels.splice(pos, 1);
            }
        });

        try {
            await Promise.all([
                this._ingress.deleteIngress(tunnel),
                this._db.delete(tunnelId),
                updateAccount,
            ]);
        } catch (e) {
            this.logger
                .withContext('tunnel', tunnelId)
                .error({
                    operation: 'delete_tunnel',
                    message: `failed to delete tunnel: ${e.message}`,
                    stack: `${e.stack}`,
                });
            return false;
        }

        this.logger.isDebugEnabled() && this.logger.debug({
            operation: 'delete_tunnel',
            tunnel: tunnelId,
            account: accountId,
        });
        return true;
    }

    async connect(tunnelId, accountId, transport, opts) {
        assert(tunnelId != undefined);
        assert(accountId != undefined);

        let tunnel = await this.get(tunnelId, accountId);
        if (tunnel instanceof Tunnel == false) {
            return false;
        }

        if (tunnel.state().connections.length >= transport.max_connections) {
            this.logger
                .withContext('tunnel',tunnelId)
                .info({
                    message: `Refused transport connection, current connections ${tunnel.state().connections.length}, max connections ${transport.max_connections}`,
                    operation: 'connect_tunnel',
                    connections: tunnel.state().connections.length,
                    max_connections: transport.max_connections,
                });
            return false;
        }

        const connection = {
            id: `${Node.identifier}:${crypto.randomUUID()}`,
            transport,
            state: {
                peer: opts.peer,
                connected_at: Date.now(),
            }
        };
        this._connectedTunnels[tunnelId] ??= {
            connections: {}
        };
        this._connectedTunnels[tunnelId].connections[connection.id] = connection;

        transport.once('close', async () => {
            this._closeTunnelConnection(tunnelId, connection.id);
        });

        this._announceTunnel(tunnelId);

        await this.update(tunnelId, accountId, (tunnel) => {
            tunnel.transport.token = crypto.randomBytes(64).toString('base64url');
        });

        this.logger
            .withContext("tunnel", tunnelId)
            .info({
                operation: 'connect_tunnel',
                peer: opts.peer,
                msg: 'tunnel connected',
            });
        return true;
    }

    _announceTunnel(tunnelId) {
        const tunnel = this._connectedTunnels[tunnelId];
        if (!tunnel) {
            return false;
        }

        const announce = {};
        announce[tunnelId] = {
            connections: Object.keys(tunnel.connections).map((cid) => {
                const c = tunnel.connections[cid];
                return {
                    id: c.id,
                    peer: c.state.peer,
                    connected_at: c.state.connected_at,
                };
            }),
        };
        return this._eventBus.publish("tunnel:announce", announce);
    }

    _announceTunnels() {
        const tunnelIds = Object.keys(this._connectedTunnels);
        const batchsize = this.tunnelAnnounceBatchSize;

        return new Promise((resolve) => {
            const processChunk = async () => {
                const chunk = tunnelIds.splice(0, batchsize);

                const tunnels = chunk.map((tunnelId) => {
                    const tunnel = this._connectedTunnels[tunnelId];
                    return {
                        tunnel: tunnelId,
                        connections: Object.keys(tunnel?.connections || {}).map((cid) => {
                            const c = tunnel.connections[cid];
                            return {
                                id: cid,
                                peer: c?.state?.peer,
                                connected_at: c?.state?.connected_at,
                            }
                        })
                    }
                }).reduce((acc, cur) => {
                    acc[cur.tunnel] = {
                        connections: cur.connections
                    }
                    return acc;
                }, {});

                await this._eventBus.publish("tunnel:announce", tunnels);
                if (tunnelIds.length > 0) {
                    setImmediate(processChunk);
                } else {
                    resolve();
                }
            };

            if (tunnelIds.length > 0) {
                setImmediate(processChunk);
            } else {
                resolve();
            }
        });
    }

    async _closeTunnelConnection(tunnelId, cid) {
        const tunnel = this._connectedTunnels[tunnelId];
        if (!tunnel) {
            return;
        }

        let cids = [];
        if (cid) {
            cids.push(cid);
        } else {
            cids = Object.keys(tunnel.connections);
        }

        const cons = cids.map(cid => {
            const con = tunnel.connections[cid];
            return new Promise(async (resolve, reject) => {
                if (!con) {
                    return resolve();
                }
                try {
                    await con.transport.destroy();
                } catch (e) {
                    this.logger
                        .withContext("tunnel", tunnelId)
                        .error({
                            message: `failed to gracefully close connection ${cid} to peer ${con.peer}`,
                        });
                }
                delete tunnel.connections[cid];
                resolve();
            })
        })

        const res = await Promise.allSettled(cons);
        await this._announceTunnel(tunnelId);

        if (Object.keys(tunnel.connections).length == 0) {
            delete this._connectedTunnels[tunnelId];
        }
    }

    async _disconnect(tunnel, connection) {
        assert(tunnel instanceof Tunnel);
        const tunnelId = tunnel.id;

        let state = this._tunnels.get(tunnelId)
        if (!state?.connected) {
            return true;
        }

        const announces = Array.from(new Set(Object.keys(state.connections)
            .map(cid => state.connections[cid].node)))
            .map(node => {
                return this._eventBus.waitFor('tunnel:announce', (announce, meta) => {
                    return announce.tunnel == tunnelId && node == meta.node.id
                }, 500);
            });

        this._eventBus.publish('tunnel:disconnect', {
            tunnel: tunnelId,
            connection
        });

        await Promise.allSettled(announces);
        state = this._tunnels.get(tunnelId)
        return state?.connected == false;
    }

    async disconnect(tunnelId, accountId) {
        assert(tunnelId != undefined);
        assert(accountId != undefined);

        const tunnel = await this.get(tunnelId, accountId);
        if (!this._isPermitted(tunnel, accountId)) {
            return undefined;
        }
        return this._disconnect(tunnel);
    }

    async authorize(tunnelId, token) {
        const result = {
            authorized: false,
            tunnel: undefined,
            account: undefined,
        };

        try {
            const tunnel = await this._get(tunnelId);
            if (!(tunnel instanceof Tunnel)) {
                return result;
            }
            const account = await this._accountService.get(tunnel.account);
            if (!(account instanceof Account)) {
                return result;
            }
            const correctToken = safeEqual(token, tunnel?.transport?.token)

            result.authorized = correctToken && !account.status.disabled;
            if (result.authorized) {
                result.tunnel = tunnel;
                result.account = account;
                result.disabled = account.status.disabled;
            }
        } catch (e) {
            result.error = e;
        }

        return result;
    }

    isLocalConnected(tunnelId) {
        return this._connectedTunnels[tunnelId] != undefined;
    }

    createConnection(tunnelId, ctx, callback) {
        let next = this._tunnels.getNextConnection(tunnelId);
        if (!next) {
            return false;
        }

        if (next.cid) {
            const connection = this._connectedTunnels[tunnelId].connections[next.cid];
            return connection.transport.createConnection(ctx.opts, callback);
        }

        do {
            const node = this._clusterService.getNode(next.node);
            if (node && !next.local) {
                this.logger.withContext('tunnel', tunnelId).debug({
                    operation: 'connection-redirect',
                    next: node.id,
                    ip: node.ip,
                    port: ctx.ingress.port,
                });
                return NodeSocket.createConnection({
                    tunnelId,
                    node,
                    port: ctx.ingress.port,
                }, callback);
            }
            const prev = next;
            next = this._tunnels.getNextConnection(tunnelId);
        } while (next != undefined && next.id != prev.id);

        return false;
    }

}

export default TunnelService;