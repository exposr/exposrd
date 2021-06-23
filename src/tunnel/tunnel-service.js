import assert from 'assert/strict';
import Endpoint from '../endpoint/index.js';
import EventBus from '../eventbus/index.js';
import Ingress from '../ingress/index.js';
import { Logger } from '../logger.js';
import Storage from '../storage/index.js';
import Node from '../utils/node.js';
import Tunnel from './tunnel.js';
import TunnelState from './tunnel-state.js';
import NodeCache from 'node-cache';
import NodeSocket from '../transport/node-socket.js';
import AccountService from '../account/account-service.js';

const logger = Logger("tunnel-service");

class TunnelService {
    constructor(callback) {
        if (TunnelService.instance !== undefined) {
            if (TunnelService._readyCallback) {
                TunnelService._readyCallback.push(callback);
            } else {
                callback && process.nextTick(callback);
            }
            return TunnelService.instance
        }
        TunnelService.instance = this;
        TunnelService._readyCallback = [callback];

        const readyCallback = async () => {
            TunnelService._readyCallback.forEach((cb) => {
                typeof cb === 'function' && cb();
            });
            delete TunnelService._readyCallback;
        };

        this.accountService = new AccountService();
        this.db = new Storage("tunnel", { callback: readyCallback });
        this.db_state = new Storage("tunnel-state");
        this.eventBus = new EventBus();
        this.connectedTunnels = {};

        this._lookupCache = new NodeCache({
            useClones: false,
            deleteOnExpire: false,
            checkperiod: 60,
        });

        this._lookupCache.on('expired', async (tunnelId) => {
            const tunnel = await this.get(tunnelId);
            if (tunnel && tunnel.state().connected) {
                this._lookupCache.set(tunnelId, tunnel, 60);
            } else {
                this._lookupCache.del(tunnelId);
            }
        });

        this.eventBus.on('disconnected', (data) => {
            this._lookupCache.del(data?.tunnelId);
        });

        this.eventBus.on('disconnect', (message) => {
            setImmediate(async () => {
                const tunnelId = message?.tunnelId;
                const connectedTunnel = this.connectedTunnels[tunnelId];
                if (!connectedTunnel) {
                    return;
                }
                const {transport, keepaliveTimer} = connectedTunnel;
                keepaliveTimer && clearInterval(keepaliveTimer);
                transport && transport.destroy();
                delete this.connectedTunnels[tunnelId];

                const stateUpdate = this.db_state.update(tunnelId, TunnelState, (tunnelState) => {
                    tunnelState.connected = false;
                    tunnelState.peer = undefined;
                    tunnelState.node = undefined;
                    tunnelState.disconnected_at = new Date().toISOString();
                });
                // The following causes tunnel endpoint access tokens to be refreshed
                const tunnelUpdate = this.update(tunnelId, undefined, (tunnel) => {});

                await Promise.allSettled([stateUpdate, tunnelUpdate]);

                this.eventBus.publish('disconnected', {
                    tunnelId
                });
            });
        });
    }

    _isPermitted(tunnel, accountId) {
        if (!(tunnel instanceof Tunnel)) {
            return false;
        }
        return accountId === undefined || tunnel.isOwner(accountId);
    }

    async get(tunnelId, accountId = undefined) {
        assert(tunnelId != undefined);

        const res = await Promise.all([
            this.db.read(tunnelId, Tunnel),
            this.db_state.read(tunnelId, TunnelState)
        ]);
        const tunnel = res[0];
        if (!tunnel) {
            return false;
        }

        if (accountId != undefined && tunnel.account !== accountId) {
            return false;
        }

        tunnel._state = res[1] || new TunnelState();

        logger.isDebugEnabled() && logger.debug({
            operation: 'get_tunnel',
            tunnel: tunnel.id,
            account: tunnel.account,
        });
        return tunnel;
    }

    async lookup(tunnelId, accountId = undefined) {
        let tunnel = this._lookupCache.get(tunnelId);
        if (tunnel === undefined) {
            tunnel = await this.get(tunnelId, accountId);
            if (tunnel && tunnel.state().connected) {
                this._lookupCache.set(tunnelId, tunnel, 60);
            }
        }
        return tunnel;
    }

    async create(tunnelId, accountId) {
        assert(tunnelId != undefined);
        assert(accountId != undefined);

        const tunnel = new Tunnel(tunnelId, accountId);
        tunnel.created_at = new Date().toISOString();
        tunnel.updated_at = tunnel.created_at;
        const created = await this.db.create(tunnelId, tunnel);
        if (!created) {
            return false;
        }

        await this.accountService.update(accountId, (account) => {
            if (!account.tunnels.includes(tunnelId)) {
                account.tunnels.push(tunnelId);
            }
        });

        logger.isDebugEnabled() && logger.debug({
            operation: 'create_tunnel',
            tunnel: tunnel.id,
            account: tunnel.account,
        });
        return created;
    }

    async update(tunnelId, accountId, cb) {
        return this.db.update(tunnelId, Tunnel, (tunnel) => {
            if (accountId != undefined && tunnel?.account !== accountId) {
                return false;
            }

            cb(tunnel);

            const endpoints = new Endpoint().getEndpoints(tunnel);
            tunnel.endpoints.ws.url = endpoints?.ws?.url;
            tunnel.endpoints.ws.token = endpoints?.ws?.token;

            const ingress = new Ingress().getIngress(tunnel);
            tunnel.ingress.http.url = ingress?.http?.url;

            tunnel.updated_at = new Date().toISOString();
        });
    }

    async delete(tunnelId, accountId = undefined) {
        assert(tunnelId != undefined);
        const tunnel = await this.get(tunnelId, accountId);
        if (tunnel instanceof Tunnel == false) {
            return false;
        }
        if (!await this.disconnect(tunnelId)) {
            logger
                .withContext('tunnel', tunnelId)
                .warn({
                    operation: 'delete_tunnel',
                    msg: 'tunnel still connected'
                })
            return false;
        };

        const updateAccount = this.accountService.update(accountId, (account) => {
            const pos = account.tunnels.indexOf(tunnelId);
            if (pos >= 0) {
                account.tunnels.splice(pos, 1);
            }
        });

        await Promise.allSettled([
            this.db.delete(tunnelId),
            this.db_state.delete(tunnelId),
            updateAccount,
        ]);

        logger.isDebugEnabled() && logger.debug({
            operation: 'delete_tunnel',
            tunnel: tunnelId,
            account: accountId,
        });
        return true;
    }

    async connect(tunnelId, transport, opts) {
        let tunnel = await this.get(tunnelId);
        if (tunnel.connected) {
            if (!await this.disconnect(tunnelId)) {
                logger
                    .withContext('tunnel',tunnelId)
                    .error({
                        operation: 'connect_tunnel',
                        msg: "Tunnel not disconnected",
                    });
                return false;
            }
        }

        logger.isDebugEnabled() &&
            assert(this.connectedTunnels[tunnelId] === undefined);
        if (this.connectedTunnels[tunnelId] != undefined) {
            logger
                .withContext('tunnel',tunnelId)
                .error({
                    operation: 'connect_tunnel',
                    msg: "Transport already connected",
                });
            return false;
        }

        const keepaliveFun = async () => {
            const node = await Node.get();
            this.eventBus.publish('keepalive', {
                tunnelId,
                node,
            });
            const updated = await this.db_state.update(tunnelId, TunnelState, (tunnelState) => {
                tunnelState.connected = true;
                tunnelState.alive_at = new Date().toISOString();
            }, { TTL: 60 });
        };

        this.connectedTunnels[tunnelId] = {
            keepaliveTimer: setInterval(keepaliveFun, 30 * 1000),
            transport
        }
        transport.once('close', () => {
            this.disconnect(tunnelId);
        });

        const tunnelState = new TunnelState();
        tunnelState.connected = true;
        tunnelState.peer = opts.peer;
        tunnelState.node = Node.identifier;
        tunnelState.connected_at = new Date().toISOString();
        tunnelState.alive_at = tunnelState.connected_at;
        if (!await this.db_state.create(tunnelId, tunnelState, { NX: false, TTL: 60 })) {
            logger
                .withContext("tunnel", tunnelId)
                .error({
                    operation: 'connect_tunnel',
                    msg: 'failed to persist tunnel state',
                });

            return false;
        }

        this.eventBus.publish('connected', {
            tunnelId,
            node: await Node.get(),
        });

        logger
            .withContext("tunnel", tunnelId)
            .info({
                operation: 'connect_tunnel',
                peer: opts.peer,
                msg: 'tunnel connected',
            });
        return true;
    }

    async disconnect(tunnelId, accountId = undefined) {
        let tunnel = await this.get(tunnelId);
        if (!this._isPermitted(tunnel, accountId)) {
            return undefined;
        }

        if (!tunnel.state().connected && this.connectedTunnels[tunnelId] == undefined) {
            return true;
        }

        // Check for stale state
        const connectedNode = await Node.get(tunnel.state().node);
        if (!connectedNode) {
            logger
                .withContext('tunnel', tunnelId)
                .warn({
                    operation: 'disconnect_tunnel',
                    msg: 'tunnel connected to non-existing node, resetting tunnel state',
                });
            await this.db_state.delete(tunnelId);
            return true;
        }

        setImmediate(() => {
            this.eventBus.publish('disconnect', {
                tunnelId
            });
        });
        try {
            await this.eventBus.waitFor('disconnected', (msg) => msg?.tunnelId == tunnelId, 4500);
        } catch (timeout) {
            logger
                .withContext('tunnel', tunnelId)
                .warn({
                    operation: 'disconnect_tunnel',
                    msg: 'no disconnected event received',
                });
        }

        tunnel = await this.get(tunnelId);
        if (!tunnel || !tunnel.state().connected) {
            logger
                .withContext("tunnel", tunnelId)
                .info({
                    operation: 'disconnect_tunnel',
                    msg: 'tunnel disconnected',
                });
            return true;
        } else {
            logger
                .withContext("tunnel", tunnelId)
                .error({
                    operation: 'disconnect_tunnel',
                    msg: 'failed to disconnect tunnel',
                });
            return false;
        }
    }

    isLocalConnected(tunnelId) {
        return this.connectedTunnels[tunnelId] != undefined;
    }

    createConnection(tunnelId, ctx, callback) {
        const connectedTunnel = this.connectedTunnels[tunnelId];
        if (connectedTunnel?.transport) {
            return connectedTunnel.transport.createConnection(ctx.opts, callback);
        }

        return NodeSocket.createConnection({
            tunnelId,
            tunnelService: this,
            port: ctx.ingress.port,
        }, callback);
    }

    async destroy() {
        const tunnels = Object.keys(this.connectedTunnels);
        const arr = []
        tunnels.forEach((tunnelId) => {
            arr.push(this.disconnect(tunnelId));
        });
        await Promise.allSettled(arr);
        await this.db.destroy();
        this.destroyed = true;
    }
}

export default TunnelService;