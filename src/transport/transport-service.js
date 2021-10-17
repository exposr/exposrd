import assert from 'assert/strict';
import { WebSocketEndpoint } from "./ws/index.js"
import { SSHEndpoint } from "./ssh/index.js";

class TransportService {
    constructor(opts) {
        if (TransportService.instance !== undefined) {
            return TransportService.instance
        }
        TransportService.instance = this;

        assert(opts != undefined, "opts is undefined");

        this._transports = {};
        if (opts.ws && opts.ws.enabled === true) {
            this._transports.ws = new WebSocketEndpoint(opts.ws);
        }

        if (opts?.ssh?.enabled === true) {
            this._transports.ssh = new SSHEndpoint(opts.ssh);
        }
    }

    async destroy() {
        this.destroyed = true;
        return Promise.allSettled(
            Object.keys(this._transports).map(k => this._transports[k].destroy())
        );
    }

    getTransports(tunnel, baseUrl) {
        const transports = {};

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
