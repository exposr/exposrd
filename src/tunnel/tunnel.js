import crypto from 'crypto';
import Storage from '../storage/index.js';
import Endpoint from '../endpoint/index.js';
import Ingress from '../ingress/index.js';
import { Logger } from '../logger.js'; const logger = Logger("tunnel");

class Tunnel {
    constructor(id, tunnelSpec = undefined) {
        this._db = new Storage("tunnel");
        this.id = id;

        const self = this;
        this._spec = this._createSpec(tunnelSpec);
        this.spec = new Proxy(this._spec, {
            set: (obj, name, value) => {
                setImmediate(async () => {
                    await self._db.set(self.id, self._spec);
                });

                return true;
            }
        });

        this.connected = false;
        this.transport = undefined;

        if (this._spec.authToken === undefined) {
            this._spec.authToken = crypto.randomBytes(64).toString('base64');
        }

        const endpoints = new Endpoint().getEndpoints(this);
        if (this._spec.endpoints.ws.enabled && endpoints.ws) {
            this._spec.endpoints.ws.url = endpoints.ws.url;
        }

        const ingress = new Ingress().getIngress(this);
        if (this._spec.ingress.http.enabled && ingress.http) {
            this._spec.ingress.http.url = ingress.http.url;
        }

        process.nextTick(async () => {
            this.sync();
        });

        logger.isDebugEnabled() && logger.debug(`tunnel=${id} spec=${JSON.stringify(this.spec)}`);
    }

    async sync() {
        await this._db.set(this.id, this._spec);
    }

    _createSpec(sourceSpec) {
        const baseSpecv1 = {
            version: "v1",
            authToken: undefined,
            endpoints: {
                ws: {
                    enabled: false,
                    url: undefined,
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
            ...merge(baseSpecv1, sourceSpec),
            version: baseSpecv1.version,
        };
    }

    authenticate(authToken) {
        return this.spec.authToken === authToken;
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