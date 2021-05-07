import crypto from 'crypto';
import querystring from 'querystring';
import WebSocketEndpoint from "./ws-endpoint.js";

class Endpoint {
    constructor(opts) {
        if (Endpoint.instance !== undefined) {
            return Endpoint.instance
        }
        this.opts = opts;

        this.endpoints = {};
        if (opts.ws && opts.ws.enabled === true) {
            this.endpoints.ws = new WebSocketEndpoint(opts.ws);
        }

        Endpoint.instance = this;
    }

    async destroy() {
        if (this.endpoints.ws) {
            await this.endpoints.ws.destroy();
        }
    }

    getEndpoints(tunnel) {
        const endpoints = {};

        if (this.opts.ws && this.opts.ws.enabled === true) {
            const token = crypto.randomBytes(64).toString('base64');
            const url = new URL(this.opts.ws.baseUrl.href);
            url.protocol = this.opts.ws.baseUrl.protocol == 'https:' ? 'wss' : 'ws';
            url.pathname =  `${WebSocketEndpoint.PATH}/${tunnel.id}`;
            url.search = '?' + querystring.encode({token: token});
            endpoints.ws = {
                url: url.href,
                token,
            }
        }

        return endpoints;
    }

}

export default Endpoint;