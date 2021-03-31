import net from 'net';
import http, { Agent } from 'http';
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

        this._agents = {};
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

    _getAgent(tunnel) {
        const newAgent = () => {
            const agent = new Agent({
                keepAlive: true,
                defaultPort: 80,
                maxSockets: 64,
                maxTotalSockets: 1024,
            });

            agent.createConnection = (opts, callback) => {
                const sock = tunnel.transport.createConnection(opts, callback);
                return sock;
            };

            return agent;
        };

        let agent;
        if (this._agents[tunnel.id] !== undefined) {
            agent = this._agents[tunnel.id].agent;
            clearTimeout(this._agents[tunnel.id].timer);
        } else {
            agent = newAgent();
            logger.isDebugEnabled() &&
                logger.withContext("tunnel", tunnel.id).debug("http agent created")
        }

        this._agents[tunnel.id] = {
            agent: agent,
            timer: setTimeout(() => {
                agent.destroy();
                delete this._agents[tunnel.id];
                logger.isDebugEnabled() &&
                    logger.withContext("tunnel", tunnel.id).debug("http agent destroyed")
            }, 65000)
        }
        return agent;

    }

    async handleRequest(req, res) {
        const tunnel = await this._getTunnel(req);
        if (!tunnel) {
            return false;
        }

        req.headers['x-forwarded-for'] = this._clientIp(req);
        req.headers['x-real-ip'] = req.headers['x-forwarded-for'];
        delete req.headers['connection'];

        const opt = {
            path: req.url,
            agent: this._getAgent(tunnel),
            method: req.method,
            headers: req.headers,
            family: 4,
            localAddress: "localhost",
            lookup: () => {
                return "127.0.0.1";
            },
            keepAlive: true,
        };

        logger.isTraceEnabled() &&
            logger.withContext('tunnel', tunnel.id).trace({
                method: req.method,
                path: req.url,
                headers: req.headers,
            });
        const clientReq = http.request(opt, (clientRes) => {
            res.writeHead(clientRes.statusCode, clientRes.headers);
            clientRes.pipe(res);
        });

        clientReq.on('error', (err) => {
            logger.isDebugEnabled() &&
                logger.withContext("tunnel", tunnel.id).debug(err);
            res.statusCode = 502;
            res.end(JSON.stringify({error: "tunnel request failed"}));
        });

        req.pipe(clientReq);
        return true
    }

}

export default HttpIngress;