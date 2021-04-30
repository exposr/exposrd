import Storage from '../storage/index.js';
import Endpoint from '../endpoint/index.js';
import Ingress from '../ingress/index.js';
import { Logger } from '../logger.js'; const logger = Logger("tunnel");

class Tunnel {
    static BASEPROPS_V1 = {
        version: "v1",
        id: undefined,
        account: undefined,
        endpoints: {
            ws: {
                enabled: false,
                url: undefined,
                token: undefined,
            },
        },
        ingress: {
            http: {
                enabled: false,
                url: undefined,
            }
        },
        upstream: {
            url: undefined,
        }
    };

    constructor(id, tunnelProps = {}) {
        this._db = new Storage("tunnel");
        this.id = id;

        this.connected = false;
        this.transport = undefined;
        this.destroyed = false;

        tunnelProps.id = id;
        this.setProps(tunnelProps, Tunnel.BASEPROPS_V1);

        logger.isDebugEnabled() && logger.debug(`tunnel=${id} props=${JSON.stringify(this.props)}`);
    }

    setProps(props, prevProps = undefined) {
        if (!prevProps) {
            prevProps = this._props;
        }

        this._props = this._createSpec(props, prevProps);
        this.props = new Proxy(this._props, {
            set: (obj, name, value) => {
                setImmediate(async () => {
                    await self._db.set(this.id, this._props);
                });

                return true;
            }
        });

        const endpoints = new Endpoint().getEndpoints(this);
        if (this._props.endpoints.ws.enabled && endpoints.ws) {
            this._props.endpoints.ws.url = endpoints.ws.url;
            this._props.endpoints.ws.token = endpoints.ws.token;
        }

        const ingress = new Ingress().getIngress(this);
        if (this._props.ingress.http.enabled && ingress.http) {
            this._props.ingress.http.url = ingress.http.url;
        }

        process.nextTick(async () => {
            this.sync();
        });
    }

    destroy() {
        this.destroyed = true;
        this.transport && this.transport.destroy();
    }

    async delete() {
        this.destroy();
        await this._db.delete(this.id);
        this._props = {};
        this.props = undefined;
        logger.isDebugEnabled() && logger.debug(`tunnel=${this.id} deleted`);
    }

    async sync() {
        await this._db.set(this.id, this._props);
    }

    _createSpec(sourceSpec, baseSpec) {
        const merge = (target, source) => {
            for (const key of Object.keys(target)) {
                if (target[key] instanceof Object && source[key] instanceof Object) {
                    Object.assign(target[key], merge(target[key], source[key]));
                } else if (source[key] != undefined) {
                    target[key] = source[key];
                }
            }

            return target;
        }

        sourceSpec = sourceSpec || {};
        return {
            ...merge(baseSpec, sourceSpec),
            version: baseSpec.version,
        };
    }

    setTransport(transport, peer) {
        if (transport === this.transport) {
            return;
        }

        if (this.tranport != undefined) {
            this.transport.removeAllListeners('close');
            this.transport.destroy();
        }

        this.connected = true;
        this.transport = transport;
        this.peer = peer;

        this.transport.once('close', () => {
            logger
                .withContext("tunnel", `${this.id}`)
                .withContext("peer", `${this.peer}`)
                .info(`Tunnel disconnected`);
            this.transport = undefined;
            this.connected = false;
            this.peer = undefined;
        });
        logger
            .withContext("tunnel", `${this.id}`)
            .withContext("peer", `${this.peer}`)
            .info(`Tunnel connected`);
    }
}

export default Tunnel;