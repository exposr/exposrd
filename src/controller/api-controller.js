import Router from 'koa-joi-router'
import Koa from 'koa';
import TunnelManager from '../tunnel/tunnel-manager.js';
import Listener from '../listener/index.js';
import { Logger } from '../logger.js'; const logger = Logger("api");

class ApiController {

    static TUNNEL_ID_REGEX = /^(?:[a-z0-9][a-z0-9\-]{4,63}[a-z0-9]|[a-z0-9]{4,63})$/;

    constructor(opts) {
        this.opts = opts;
        this.httpListener = new Listener().getListener('http');
        this.tunnelManager = new TunnelManager();
        this._initializeRoutes();
        this._initializeServer();

    }

    _initializeRoutes() {

        const router = this.router = Router();
        const app = this.app = new Koa();

        const handleError = async (ctx, next) => {
            if (!ctx.invalid) {
                return next(ctx, next);
            }

            if (ctx.invalid.type) {
                ctx.status = 400;
                ctx.body = {
                    error:  `content-type: ${ctx.invalid.type.msg}`,
                }
            } else if (ctx.invalid.params) {
                ctx.status = parseInt(ctx.invalid.params.status) || 400;
                ctx.body = {
                    error: ctx.invalid.params.msg
                }
            } else if (ctx.invalid.body) {
                ctx.status = parseInt(ctx.invalid.body.status) || 400;
                ctx.body = {
                    error: ctx.invalid.body.msg
                }
            } else {
                ctx.status = 400;
                ctx.body = {
                    error: 'unable to determine error'
                }
            }

        };

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

        router.route({
            method: 'put',
            path: '/v1/tunnel/:tunnel_id',
            validate: {
                type: 'json',
                maxBody: '64kb',
                failure: 400,
                continueOnError: true,
                params: {
                    tunnel_id: Router.Joi.string().regex(ApiController.TUNNEL_ID_REGEX).required(),
                },
                body: {
                    ingress: {
                        http: {
                            enabled: Router.Joi.boolean(),
                        },
                    },
                    upstream: {
                        url: Router.Joi.string().uri(),
                    },
                },
            },
            handler: [handleError, async (ctx, next) => {
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
                const tunnelId = ctx.params.tunnel_id;
                const tunnel = await this.tunnelManager.create(tunnelId, config, {allowExists: true});
                if (tunnel === false) {
                    ctx.status = 403;
                } else {
                    ctx.body = tunnelInfo(tunnel);
                    ctx.status = 201;
                }
            }]
        });

        router.delete('/v1/tunnel/:id', async (ctx, next) => {
            ctx.status = 501;
            return;
        });

        router.route({
            method: 'get',
            path: '/v1/tunnel/:tunnel_id',
            validate: {
                failure: 400,
                continueOnError: true,
                params: {
                    tunnel_id: Router.Joi.string().regex(ApiController.TUNNEL_ID_REGEX).required(),
                }
            },
            handler: [handleError, async (ctx, next) => {
                const tunnelId = ctx.params.tunnel_id;
                const tunnel = await this.tunnelManager.get(tunnelId);
                if (tunnel === false) {
                    ctx.status = 404;
                    ctx.body = {
                        error: 'no such tunnel'
                    }
                } else {
                    ctx.status = 200;
                    ctx.body = tunnelInfo(tunnel);
                }
            }]
        });

        app.use(router.middleware());
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