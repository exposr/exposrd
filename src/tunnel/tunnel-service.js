import assert from 'assert/strict';
import Endpoint from '../endpoint/index.js';
import EventBus from '../eventbus/index.js';
import Ingress from '../ingress/index.js';
import { Logger } from '../logger.js';
import Storage from '../storage/index.js';
import Serializer from '../storage/serializer.js';
import Node from '../utils/node.js';
import Tunnel from './tunnel.js';
import TunnelState from './tunnel-state.js';

const logger = Logger("tunnel-service");

class TunnelService {
    constructor() {
        if (TunnelService.instance !== undefined) {
            return TunnelService.instance
        }
        TunnelService.instance = this;

        this.db = new Storage("tunnel");
        this.db_state = new Storage("tunnel-state");
        this.eventBus = new EventBus();
        this.connectedTunnels = {};

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
                await this.db_state.update(tunnelId, TunnelState, (tunnelState) => {
                    tunnelState.connected = false;
                    tunnelState.peer = undefined;
                    tunnelState.node = undefined;
                    tunnelState.disconnected_at = new Date().toISOString();
                });

                this.eventBus.publish('disconnected', {
                    tunnelId
                });
            });
        });
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

    async create(tunnelId, accountId) {
        assert(tunnelId != undefined);
        assert(accountId != undefined);

        const tunnel = new Tunnel(tunnelId, accountId);
        const created = await this.db.create(tunnelId, tunnel);
        if (!created) {
            return false;
        }

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
        await this.db.delete(tunnelId);

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
            this.eventBus.publish('keepalive', {
                tunnelId,
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
        if (!await this.db_state.create(tunnelId, tunnelState, { NX: false })) {
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
            state: Serializer.serialize(tunnelState),
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

    async disconnect(tunnelId) {
        let tunnel = await this.get(tunnelId);
        if (this.connectedTunnels[tunnelId] === undefined) {
            return true;
        }
        setImmediate(() => {
            this.eventBus.publish('disconnect', {
                tunnelId
            });
        });
        try {
            await this.eventBus.waitFor('disconnected', (msg) => msg?.tunnelId == tunnelId, 10000);
        } catch (timeout) {
            logger
                .withContext('tunnel', tunnelId)
                .warn({
                    operation: 'disconnect_tunnel',
                    msg: 'no disconnected event after 10s',
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

    createConnection(tunnelId, opts, callback) {
        const connectedTunnel = this.connectedTunnels[tunnelId];
        if (!connectedTunnel?.transport) {
            return undefined;
        }
        return transport.createConnection(opts, callback);
    }

    async destroy() {
        const tunnels = Object.keys(this.connectedTunnels);
        const arr = []
        tunnels.forEach((tunnelId) => {
            arr.push(this.disconnect(tunnelId));
        });
        await Promise.all(arr);
        await this.db.destroy();
        this.destroyed = true;
    }
}

export default TunnelService;