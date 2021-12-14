import assert from 'assert/strict';
import crypto from 'crypto';
import NodeCache from 'node-cache';
import AccountService from '../account/account-service.js';
import Account from '../account/account.js';
import EventBus from '../eventbus/index.js';
import Ingress from '../ingress/index.js';
import { Logger } from '../logger.js';
import Storage from '../storage/index.js';
import NodeSocket from '../transport/node-socket.js';
import { safeEqual } from "../utils/misc.js";
import Node, { NodeService } from '../utils/node.js';
import TunnelState from './tunnel-state.js';
import Tunnel from './tunnel.js';

const logger = Logger("tunnel-service");

class TunnelService {

    static TUNNEL_ID_REGEX = /^(?:[a-z0-9][a-z0-9\-]{4,63}[a-z0-9]|[a-z0-9]{4,63})$/;

    constructor() {
        if (TunnelService.instance instanceof TunnelService) {
            TunnelService.ref++;
            return TunnelService.instance;
        }
        TunnelService.ref = 1;
        TunnelService.instance = this;

        this.accountService = new AccountService();
        this.db = new Storage("tunnel");
        this.db_state = new Storage("tunnel-state");
        this.eventBus = new EventBus();
        this.nodeService = new NodeService();
        this.connectedTunnels = {};

        this._lookupCache = new NodeCache({
            useClones: false,
            deleteOnExpire: false,
            checkperiod: 60,
        });

        this._lookupCache.on('expired', async (tunnelId) => {
            const tunnel = await this._get(tunnelId);
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
                    return true;
                });

                // Refresh connection token
                const tunnelUpdate = this.update(tunnelId, undefined, (tunnel) => {
                    tunnel.transport.token = crypto.randomBytes(64).toString('base64url');
                });

                await Promise.allSettled([stateUpdate, tunnelUpdate]);

                this.eventBus.publish('disconnected', {
                    tunnelId
                });
            });
        });
    }

    async destroy() {
        if (--TunnelService.ref == 0) {
            this.destroyed = true;
            const tunnels = Object.keys(this.connectedTunnels).map(async (tunnelId) => {
                const tunnel = await this.lookup(tunnelId);
                return this._disconnect(tunnel);
            });
            await Promise.allSettled(tunnels);
            return Promise.allSettled([
                this.db.destroy(),
                this.db_state.destroy(),
                this.nodeService.destroy(),
                this.eventBus.destroy(),
                this.accountService.destroy(),
            ]);
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

        const [tunnel, tunnelState] = await Promise.all([
            this.db.read(tunnelId, Tunnel),
            this.db_state.read(tunnelId, TunnelState)
        ]);

        if (tunnel instanceof Array && tunnelState instanceof Array) {
            tunnel.forEach((t, i) => {
                t._state = tunnelState[i] || new TunnelState();
            });

        } else if (tunnel instanceof Tunnel) {
            tunnel._state = tunnelState || new TunnelState();
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

        logger.isDebugEnabled() && logger.debug({
            operation: 'get_tunnel',
            tunnel: tunnel.id,
            account: tunnel.account,
        });
        return tunnel;
    }

    async lookup(tunnelId) {
        let tunnel = this._lookupCache.get(tunnelId);
        if (tunnel === undefined) {
            tunnel = await this._get(tunnelId);
            if (tunnel && tunnel.state().connected) {
                this._lookupCache.set(tunnelId, tunnel, 60);
            }
        }
        return tunnel;
    }

    async list(cursor = 0, count = 10, verbose = false) {
        const res = await this.db.list(cursor, count);
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
        assert(tunnelId != undefined);
        assert(accountId != undefined);
        return this.db.update(tunnelId, Tunnel, async (tunnel) => {
            if (tunnel?.account !== accountId) {
                return false;
            }

            const orig = tunnel.clone();
            cb(tunnel);

            const updatedIngress = await new Ingress().updateIngress(tunnel, orig);
            if (updatedIngress instanceof Error) {
                const err = updatedIngress;
                logger.isDebugEnabled() &&
                    logger
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
            logger
                .withContext('tunnel', tunnelId)
                .error({
                    operation: 'delete_tunnel',
                    msg: 'tunnel still connected'
                });
            return false;
        };

        const updateAccount = this.accountService.update(accountId, (account) => {
            const pos = account.tunnels.indexOf(tunnelId);
            if (pos >= 0) {
                account.tunnels.splice(pos, 1);
            }
        });

        try {
            await Promise.all([
                new Ingress().deleteIngress(tunnel),
                this.db.delete(tunnelId),
                this.db_state.delete(tunnelId),
                updateAccount,
            ]);
        } catch (e) {
            logger
                .withContext('tunnel', tunnelId)
                .error({
                    operation: 'delete_tunnel',
                    message: `failed to delete tunnel: ${e.message}`,
                    stack: `${e.stack}`,
                });
            return false;
        }

        logger.isDebugEnabled() && logger.debug({
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
        if (tunnel.connected) {
            if (!await this.disconnect(tunnelId, accountId)) {
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
            const node = await this.nodeService.get();
            this.eventBus.publish('keepalive', {
                tunnelId,
                node,
            });
            const updated = await this.db_state.update(tunnelId, TunnelState, (tunnelState) => {
                tunnelState.connected = true;
                tunnelState.alive_at = new Date().toISOString();
                return true;
            }, { TTL: 60 });
        };

        this.connectedTunnels[tunnelId] = {
            keepaliveTimer: setInterval(keepaliveFun, 30 * 1000),
            transport
        };
        transport.once('close', async () => {
            const tunnel = await this.lookup(tunnelId);
            if (tunnel instanceof Tunnel) {
                this._disconnect(tunnel);
            }
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
            node: await this.nodeService.get(),
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

    async _disconnect(tunnel) {
        assert(tunnel instanceof Tunnel);

        const tunnelId = tunnel.id;
        if (!tunnel.state().connected && this.connectedTunnels[tunnelId] == undefined) {
            return true;
        }

        // Check for stale state
        const connectedNode = await this.nodeService.get(tunnel.state().node);
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

        tunnel = await this._get(tunnelId);
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

    async disconnect(tunnelId, accountId) {
        assert(tunnelId != undefined);
        assert(accountId != undefined);
        let tunnel = await this.get(tunnelId, accountId);
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
            const account = await this.accountService.get(tunnel.account);
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

}

export default TunnelService;