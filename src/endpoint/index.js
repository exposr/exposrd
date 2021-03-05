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

    getEndpoints(tunnel) {
        const endpoints = {};

        if (this.opts.ws && this.opts.ws.enabled === true) {
            const url = new URL(this.opts.ws.subdomainUrl.href);
            url.protocol = this.opts.ws.subdomainUrl.protocol == 'https:' ? 'wss' : 'ws';
            url.hostname = `${tunnel.id}.${url.hostname}`;
            url.search = '?' + querystring.encode({token: tunnel.spec.authToken});
            endpoints.ws = {
                url: url.href
            }
        }

        return endpoints;
    }

}

export default Endpoint;