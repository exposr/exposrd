import http from 'http';
import querystring from 'querystring';
import url from 'url';
import WebSocket from 'ws';
import Router from 'koa-router';
import Koa from 'koa';
import net from 'net';
import TunnelManager from './tunnel-manager.js';
import Logger from './logger.js';

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

        app.use(async (ctx, next) => {
            await next();
            Logger.info({
                request: {
                    path: ctx.request.url,
                    method: ctx.request.method,
                    headers: ctx.request.headers
                },
                response: {
                    headers: ctx.response.header,
                    status: ctx.response.status,
                    body: ctx.response.body
                }
            });
        });

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
                auth_token: tunnel.authToken,
                ingress: tunnel.ingress,
                tunnels,
            }
            return info;
        };

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

        const unauthorized = (sock) => {
            sock.end(`HTTP/1.1 401 Unauthorized\r\n\r\n`);
        };

        const authenticate = (req, tunnel) => {
            const requestUrl = url.parse(req.url);
            const queryParams = querystring.decode(requestUrl.query);
            const token = queryParams['token'];
            return tunnel != undefined && tunnel.authenticate(token) === true;
        };

        server.on('upgrade', async (req, sock, head) => {
            const tunnelConfig = await getTunnel(req);
            if (tunnelConfig == undefined) {
                return unauthorized(sock);
            }

            const tunnel = tunnelConfig.tunnels['websocket'];
            if (authenticate(req, tunnel) !== true) {
                return unauthorized(sock);
            }

            req.headers['x-forwarded-for'] = clientIp(req);
            req.headers['x-real-ip'] = req.headers['x-forwarded-for'];
            tunnel.httpRequest(wss, req, sock, head);
        });
    }

    listen(cb) {
        const listenError = (err) => {
            Logger.error(`Failed to start server: ${err.message}`);
        };
        this.server.once('error', listenError);
        this.server.listen({port: this.opts.port}, () => {
            this.server.removeListener('error', listenError);
            cb();
        });
    }

    shutdown(cb) {
        this.tunnelManager.shutdown();
        this.server.close(cb);
    }
}

export default TunnelServer;