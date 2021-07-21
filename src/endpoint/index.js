import WebSocketEndpoint from "./ws-endpoint.js";
import SSHEndpoint from "./ssh-endpoint.js";
import { assert } from 'console';

class Endpoint {
    constructor(opts) {
        if (Endpoint.instance !== undefined) {
            return Endpoint.instance
        }
        assert(opts != undefined);
        this.opts = opts;

        this.endpoints = {};
        if (opts.ws && opts.ws.enabled === true) {
            this.endpoints.ws = new WebSocketEndpoint(opts.ws);
        }

        if (opts?.ssh?.enabled === true) {
            this.endpoints.ssh = new SSHEndpoint(opts.ssh);
        }

        Endpoint.instance = this;
    }

    async destroy() {
        return Promise.allSettled(
            Object.keys(this.endpoints).map(k => this.endpoints[k].destroy())
        );
    }

    getEndpoints(tunnel, baseUrl) {
        const endpoints = {};

        if (tunnel.endpoints?.ws?.enabled === true && this.endpoints.ws) {
            endpoints.ws = {
                ...tunnel.endpoints.ws,
                ...this.endpoints.ws.getEndpoint(tunnel, baseUrl),
            };
        }

        if (tunnel.endpoints?.ssh?.enabled === true && this.endpoints.ssh) {
            endpoints.ssh = {
                ...tunnel.endpoints.ssh,
                ...this.endpoints.ssh.getEndpoint(tunnel, baseUrl),
            };
        }

        return endpoints;
    }

}

export default Endpoint;