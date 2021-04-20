import Router from 'koa-router';
import koaBody from 'koa-body';
import Koa from 'koa';
import TunnelManager from '../tunnel/tunnel-manager.js';
import Listener from '../listener/index.js';
import { Logger } from '../logger.js'; const logger = Logger("api");

class ApiController {
    constructor(opts) {
        this.opts = opts;
        this.httpListener = new Listener().getListener('http');
        this.tunnelManager = new TunnelManager();
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
                    method: ctx.request.method,
                    path: ctx.request.url,
                    headers: ctx.request.headers,
                    body: ctx.request.body
                },
                response: {
                    status: ctx.response.status,
                    headers: ctx.response.header,
                    body: ctx.response.body
                }
            });
        });

        app.use(koaBody());

        const tunnelInfo = (tunnel) => {
            const info = {
                id: tunnel.id,
                auth_token: tunnel.spec.authToken,
                endpoints: {},
                ingress: {},
            }

            Object.keys(tunnel.spec.endpoints).forEach((k) => {
                const endpoint = tunnel.spec.endpoints[k];
                if (endpoint.enabled) {
                    info.endpoints[k] = endpoint;
                }
            });

            Object.keys(tunnel.spec.ingress).forEach((k) => {
                const ingress = tunnel.spec.ingress[k];
                if (ingress.enabled) {
                    info.ingress[k] = ingress;
                }
            });

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
            const config = {
                ingress: {
                    http: {
                        enabled: ctx.request.body?.ingress?.http?.enabled,
                    }
                },
                upstream: {
                    url: ctx.request.body?.upstream?.url,
                },
                endpoints: {
                    ws: {
                        enabled: true,
                    }
                }
            };
            const tunnel = await this.tunnelManager.create(tunnelId, config, {allowExists: true});
            if (tunnel === false) {
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
        const appCallback = this.appCallback;
        this.httpListener.use('request', async (ctx, next) => {
            appCallback(ctx.req, ctx.res);
        });

    }

    shutdown(cb) {
        cb();
    }
}

export default ApiController;