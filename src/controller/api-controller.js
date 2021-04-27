import Router from 'koa-joi-router'
import Koa from 'koa';
import AccountManager from '../account/account-manager.js';
import Account from '../account/account.js';
import Listener from '../listener/index.js';
import Config from '../config.js';
import { Logger } from '../logger.js'; const logger = Logger("api");

class ApiController {

    static TUNNEL_ID_REGEX = /^(?:[a-z0-9][a-z0-9\-]{4,63}[a-z0-9]|[a-z0-9]{4,63})$/;

    constructor(opts) {
        this.opts = opts;
        this.httpListener = new Listener().getListener('http');
        this.accountManager = new AccountManager();
        this._initializeRoutes();
        this._initializeServer();

        if (Config.get('allow-registration')) {
            logger.warn({message: "Public account registration is enabled"});
        }
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

        const handleAuth = async (ctx, next) => {
            const token = ctx.request.header.authorization ? ctx.request.header.authorization.split(' ')[1] : undefined;
            const accountId = token ? Buffer.from(token, 'base64').toString('utf-8') : undefined;
            if (!token || !accountId) {
                ctx.status = 401;
                ctx.body = {error: 'no access token'}
                return;
            }

            const account = await this.accountManager.get(accountId);
            if (account instanceof Account == false) {
                ctx.status = 401;
                ctx.body = {error: 'permission denied'}
                return;
            }

            ctx._context = {
                account
            };

            return next();
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
                    headers: ctx.response.headers,
                    body: ctx.response.body
                }
            });
        });

        const tunnelInfo = (tunnel) => {
            const info = {
                id: tunnel.id,
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
            handler: [handleError, handleAuth, async (ctx, next) => {
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
                const account = ctx._context.account;
                const tunnel = await account.createTunnel(tunnelId, config, {allowExists: true});
                if (tunnel === false) {
                    ctx.status = 403;
                } else {
                    ctx.body = tunnelInfo(tunnel);
                    ctx.status = 201;
                }
            }]
        });

        router.route({
            method: 'delete',
            path: '/v1/tunnel/:tunnel_id',
            validate: {
                failure: 400,
                continueOnError: true,
                params: {
                    tunnel_id: Router.Joi.string().regex(ApiController.TUNNEL_ID_REGEX).required(),
                }
            },
            handler: [handleError, handleAuth, async (ctx, next) => {
                const tunnelId = ctx.params.tunnel_id;
                const account = ctx._context.account;
                const result = await account.deleteTunnel(tunnelId);
                if (result === false) {
                    ctx.status = 404;
                    ctx.body = {
                        error: 'no such tunnel'
                    }
                } else {
                    ctx.status = 204;
                }
            }]
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
            handler: [handleError, handleAuth, async (ctx, next) => {
                const tunnelId = ctx.params.tunnel_id;
                const account = ctx._context.account;
                const tunnel = await account.getTunnel(tunnelId);
                if (!tunnel) {
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

        const accountProps = (account) => {
            const {accountId, formatted} = account.getId();
            return {
                account_id: accountId,
                account_id_hr: formatted,
            }
        };

        router.route({
            method: 'post',
            path: '/v1/account',
            validate: {
                failure: 400,
                continueOnError: true,
            },
            handler: [handleError, async (ctx, next) => {
                const allowRegistration = Config.get('allow-registration') || false;
                if (!allowRegistration) {
                    ctx.status = 404;
                    return;
                }

                const account = await this.accountManager.create();
                if (account === undefined) {
                    ctx.status = 503;
                    return;
                }
                ctx.status = 201;
                ctx.body = accountProps(account) ;
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