import Router from 'koa-router';
import Koa from 'koa';
import TunnelManager from './tunnel-manager.js';
import WebSocketServer from './tunnel/ws-server.js';
import Listener from './listener/index.js';
import { Logger } from './logger.js'; const logger = Logger("tunnel-server");

class ApiServer {
    constructor(opts) {
        this.opts = opts;
        this.httpListener = new Listener().getListener('http');
        this.tunnelManager = new TunnelManager(this.opts);
        this._initializeRoutes();
        this._initializeServer();
    }

    _initializeRoutes() {

        const router = this.router = new Router();
        const app = this.app = new Koa();

        app.use(async (ctx, next) => {
            await next();
            logger.info({
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

    _initializeServer() {
        const wsServer = new WebSocketServer({
            ...this.opts,
            tunnelManager: this.tunnelManager
        });

        const appCallback = this.appCallback;
        this.httpListener.use('request', async (ctx, next) => {
            appCallback(ctx.req, ctx.res);
        });

    }

    shutdown(cb) {
        this.tunnelManager.shutdown();
    }
}

export default ApiServer;