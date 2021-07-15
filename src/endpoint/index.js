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

    static getEndpoints(tunnel, baseUrl) {
        const endpoints = {};

        if (tunnel.endpoints?.ws?.enabled === true) {
            const url = new URL(baseUrl);
            url.protocol = baseUrl.protocol == 'https:' ? 'wss' : 'ws';
            url.pathname =  `${WebSocketEndpoint.PATH}/${tunnel.id}`;
            url.search = '?' + querystring.encode({token: tunnel.endpoints.token});
            endpoints.ws = {
                ...tunnel.endpoints.ws,
                url: url.href,
            };
        }

        return endpoints;
    }

}

export default Endpoint;