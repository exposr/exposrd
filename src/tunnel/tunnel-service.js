import assert from 'assert/strict';
import Endpoint from '../endpoint/index.js';
import EventBus from '../eventbus/index.js';
import Ingress from '../ingress/index.js';
import { Logger } from '../logger.js';
import Storage from '../storage/index.js';
import Serializer from '../storage/serializer.js';
import Node from '../utils/node.js';
import Tunnel from './tunnel.js';

const logger = Logger("tunnel-service");

class TunnelService {
    constructor() {
        if (TunnelService.instance !== undefined) {
            return TunnelService.instance
        }
        TunnelService.instance = this;

        this.db = new Storage("tunnel");
        this.eventBus = new EventBus();
        this.connectedTransports = {};

        this.eventBus.on('disconnect', (message) => {
            setImmediate(async () => {
                const tunnelId = message?.tunnelId;
                const transport = this.connectedTransports[tunnelId];
                if (!transport) {
                    return;
                }

                await this.db.update(tunnelId, Tunnel, (tunnel) => {
                    tunnel.connected = false;
                    tunnel.connection.peer = undefined;
                    tunnel.connection.node = undefined;
                });

                delete this.connectedTransports[tunnelId];
                transport.destroy();
                this.eventBus.publish('disconnected', {
                    tunnelId
                });
            });
        });
    }

    async get(tunnelId, accountId = undefined) {
        assert(tunnelId != undefined);

        const tunnel = await this.db.read(tunnelId, Tunnel);
        if (!tunnel) {
            return false;
        }

        if (accountId != undefined && tunnel.account !== accountId) {
            return false;
        }
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
            assert(this.connectedTransports[tunnelId] === undefined);
        if (this.connectedTransports[tunnelId] != undefined) {
            logger
                .withContext('tunnel',tunnelId)
                .error({
                    operation: 'connect_tunnel',
                    msg: "Transport already connected",
                });
            return false;
        }

        this.connectedTransports[tunnelId] = transport;
        transport.once('close', () => {
            this.disconnect(tunnelId);
        });

        tunnel = await this.db.update(tunnelId, Tunnel, (updated) => {
            updated.connected = true;
            updated.connection.peer = opts.peer;
            updated.connection.node = Node.identifier;
        });

        this.eventBus.publish('connected', {
            tunnelId,
            peer: opts.peer,
            tunnel: Serializer.serialize(tunnel),
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
        if (!tunnel?.connected) {
            return true;
        }
        setImmediate(() => {
            this.eventBus.publish('disconnect', {
                tunnelId
            });
        });
        try {
            await this.eventBus.waitFor('disconnected', (msg) => msg?.tunnelId == tunnelId, 10);
        } catch (timeout) {
            logger
                .withContext('tunnel', tunnelId)
                .warn({
                    operation: 'disconnect_tunnel',
                    msg: 'no disconnected event after 10s',
                });
        }

        tunnel = await this.get(tunnelId);
        if (!tunnel?.connected) {
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
        const transport = this.connectedTransports[tunnelId];
        if (!transport) {
            return undefined;
        }
        return transport.createConnection(opts, callback);
    }
}

export default TunnelService;