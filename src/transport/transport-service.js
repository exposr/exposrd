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

        this._endpoints = {};
        if (opts.ws && opts.ws.enabled === true) {
            this._endpoints.ws = new WebSocketEndpoint(opts.ws);
        }

        if (opts?.ssh?.enabled === true) {
            this._endpoints.ssh = new SSHEndpoint(opts.ssh);
        }
    }

    async destroy() {
        this.destroyed = true;
        return Promise.allSettled(
            Object.keys(this._endpoints).map(k => this._endpoints[k].destroy())
        );
    }

    getEndpoints(tunnel, baseUrl) {
        const endpoints = {};

        if (tunnel.endpoints?.ws?.enabled === true && this._endpoints.ws) {
            endpoints.ws = {
                ...tunnel.endpoints.ws,
                ...this._endpoints.ws.getEndpoint(tunnel, baseUrl),
            };
        }

        if (tunnel.endpoints?.ssh?.enabled === true && this._endpoints.ssh) {
            endpoints.ssh = {
                ...tunnel.endpoints.ssh,
                ...this._endpoints.ssh.getEndpoint(tunnel, baseUrl),
            };
        }

        return endpoints;
    }

}

export default TransportService;
