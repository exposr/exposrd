import assert from 'assert/strict';
import { WebSocketEndpoint } from "./ws/index.js"
import { SSHEndpoint } from "./ssh/index.js";

class TransportService {
    constructor(opts) {
        if (TransportService.instance instanceof TransportService) {
            TransportService.ref++;
            return TransportService.instance
        }
        TransportService.ref = 1;
        TransportService.instance = this;

        assert(opts != undefined, "opts is undefined");

        this.max_connections = opts.max_connections || 1;

        this._transports = {};
        const ready = [];
        if (opts.ws && opts.ws.enabled === true) {
            const promise = new Promise((resolve, reject) => {
                this._transports.ws = new WebSocketEndpoint({
                    max_connections: opts.max_connections,
                    ...opts.ws,
                    callback: (err) => err ? reject(err) : resolve(),
                });
            });
            ready.push(promise);
        }

        if (opts?.ssh?.enabled === true) {
            const promise = new Promise((resolve, reject) => {
                this._transports.ssh = new SSHEndpoint({
                    max_connections: opts.max_connections,
                    ...opts.ssh,
                    callback: (err) => err ? reject(err) : resolve(),
                });
            });
            ready.push(promise);
        }

        Promise.all(ready)
            .then(() => {
                typeof opts.callback === 'function' && opts.callback();
            })
            .catch((err) => {
                typeof opts.callback === 'function' && opts.callback(err);
            });
    }

    async destroy() {
        if (--TransportService.ref == 0) {
            delete TransportService.instance;
            this.destroyed = true;
            return Promise.allSettled(
                Object.keys(this._transports).map(k => this._transports[k].destroy())
            );
        }
    }

    getTransports(tunnel, baseUrl) {
        const transports = {
            max_connections: this.max_connections
        };

        if (tunnel.transport?.ws?.enabled === true && this._transports.ws) {
            transports.ws = {
                ...tunnel.transport.ws,
                ...this._transports.ws.getEndpoint(tunnel, baseUrl),
            };
        }

        if (tunnel.transport?.ssh?.enabled === true && this._transports.ssh) {
            transports.ssh = {
                ...tunnel.transport.ssh,
                ...this._transports.ssh.getEndpoint(tunnel, baseUrl),
            };
        }

        return transports;
    }

}

export default TransportService;
