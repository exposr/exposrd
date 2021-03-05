import net from 'net';
import http from 'http';
import Listener from '../listener/index.js';
import TunnelManager from '../tunnel/tunnel-manager.js';
import { Logger } from '../logger.js'; const logger = Logger("http-ingress");

class HttpIngress {
    constructor(opts) {
        this.opts = opts;
        this.tunnelManager = new TunnelManager();
        this.httpListener = new Listener().getListener('http');
        this.httpListener.use('request', async (ctx, next) => {
            if (!await this.handleRequest(ctx.req, ctx.res)) {
                next();
            }
        });
    }

    _getTunnelId(hostname) {
        const host = hostname.toLowerCase().split(":")[0];
        const tunnelId = host.substr(0, host.indexOf(this.opts.subdomainUrl.hostname) - 1);
        return tunnelId !== '' ? tunnelId : undefined;
    }

    async _getTunnel(req) {
        const hostname = req.headers.host;
        if (hostname === undefined) {
            return;
        }

        const tunnelId = this._getTunnelId(hostname);
        if (tunnelId === undefined) {
            return;
        }

        const tunnel = await this.tunnelManager.get(tunnelId);
        return tunnel;
    }

    _clientIp(req) {
        let ip;
        if (req.headers['x-forwarder-for']) {
            ip = req.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
        }
        return net.isIP(ip) ? ip : req.socket.remoteAddress;
    }

    async handleRequest(req, res) {
        const tunnel = await this._getTunnel(req);
        if (!tunnel) {
            return false;
        }

        req.headers['x-forwarded-for'] = this._clientIp(req);
        req.headers['x-real-ip'] = req.headers['x-forwarded-for'];

        const opt = {
            path: req.url,
            agent: tunnel.transport.httpAgent,
            method: req.method,
            headers: req.headers,
            keepAlive: true,
        };

        const clientReq = http.request(opt, (clientRes) => {
            res.writeHead(clientRes.statusCode, clientRes.headers);
            clientRes.pipe(res);
        });

        clientReq.on('error', (err) => {
            res.statusCode = 502;
            res.end(JSON.stringify({error: "tunnel request failed"}));
        });

        req.pipe(clientReq);
        return true
    }

}

export default HttpIngress;