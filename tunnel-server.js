import http from 'http';
import WebSocket from 'ws';
import Router from 'koa-router';
import Koa from 'koa';
import net from 'net';
import TunnelManager from './tunnel-manager.js';

class TunnelServer {
    constructor(opts) {
        this.opts = opts;
        this.tunnelManager = new TunnelManager(this.opts);
        this._initializeRoutes();
        this._initializeServer();
    }

    _initializeRoutes() {

        const router = this.router = new Router();
        const app = this.app = new Koa();

        const tunnelInfo = (tunnel) => {
            const tunnels = {};
            Object.keys(tunnel.tunnels).forEach((k) => {
                const entry = tunnel.tunnels[k];
                tunnels[k] = {
                    endpoint: entry.endpoint,
                };
            });
            const info = {
                id: tunnel.id,
                ingress: tunnel.ingress,
                tunnels,
            }
            return info;
        };

        router.post('/v1/tunnel', async (ctx, next) => {
            const tunnel = await this.tunnelManager.create();
            if (tunnel == false) {
                ctx.status = 403;
            } else {
                ctx.body = tunnelInfo(tunnel);
                ctx.status = 201;
            }
            return;
        });

        router.put('/v1/tunnel/:id', async (ctx, next) => {
            const tunnelId = ctx.params.id;
            if (!/^(?:[a-z0-9][a-z0-9\-]{4,63}[a-z0-9]|[a-z0-9]{4,63})$/.test(tunnelId)) {
                ctx.status = 400;
                ctx.body = {
                    error: "invalid tunnel id",
                };
                return;
            }
            const tunnel = await this.tunnelManager.create(tunnelId, {allowExists: true});
            if (tunnel == false) {
                ctx.status = 403;
            } else {
                ctx.body = tunnelInfo(tunnel);
                ctx.status = 201;
            }
            return;
        });

        router.delete('/v1/tunnel/:id', async (ctx, next) => {
            ctx.status = 501;
            return;
        });

        router.get('/v1/tunnel/:id', async (ctx, next) => {
            ctx.status = 501;
            return;
        });

        app.use(router.routes());
        app.use(router.allowedMethods());
        this.appCallback = app.callback();
    }

    _getTunnelId(hostname) {
        const host = hostname.toLowerCase().split(":")[0];
        const tunnelId = host.substr(0, host.indexOf(this.opts.subdomainUrl.hostname) - 1);
        return tunnelId !== '' ? tunnelId : undefined;
    }

    _initializeServer() {
        const server = this.server = http.createServer();
        const wss = this.wss = new WebSocket.Server({ noServer: true });

        const getTunnel = async (req) => {
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
        };

        const clientIp = (req) => {
            let ip;
            if (req.headers['x-forwarder-for']) {
                ip = req.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
            }
            return net.isIP(ip) ? ip : req.socket.remoteAddress;
        }

        server.on('request', async (req, res) => {
            const tunnel = await getTunnel(req);
            if (tunnel) {
                req.headers['x-forwarded-for'] = clientIp(req);
                req.headers['x-real-ip'] = req.headers['x-forwarded-for'];
                const wsTunnel = tunnel.tunnels['websocket'];
                if (wsTunnel) {
                    wsTunnel.httpRequest(wss, req, res);
                } else {
                    res.statusCode = 401;
                }
            } else {
                this.appCallback(req, res);
            }
        });

        server.on('upgrade', async (req, sock, head) => {
            const tunnel = await getTunnel(req);
            if (tunnel) {
                req.headers['x-forwarded-for'] = clientIp(req);
                const wsTunnel = tunnel.tunnels['websocket'];
                if (wsTunnel) {
                    wsTunnel.httpRequest(wss, req, sock, head);
                } else {
                    res.statusCode = 401;
                }
            } else {
                sock.end(`HTTP/1.1 401 Unauthorized\r\n\r\n`);
            }
        });
    }

    listen(port) {
        this.server.listen(port);
    }
}

export default TunnelServer;