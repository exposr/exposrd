import Koa from 'koa';
import Router from 'koa-joi-router';
import AccountService from '../account/account-service.js';
import Account from '../account/account.js';
import Config from '../config.js';
import Endpoint from '../endpoint/index.js';
import Listener from '../listener/index.js';
import { Logger } from '../logger.js';
import Tunnel from '../tunnel/tunnel.js';
import {
    ERROR_AUTH_NO_ACCESS_TOKEN,
    ERROR_AUTH_PERMISSION_DENIED,
    ERROR_BAD_INPUT,
    ERROR_TUNNEL_NOT_FOUND
} from '../utils/errors.js';

const logger = Logger("api");

class ApiController {

    static TUNNEL_ID_REGEX = /^(?:[a-z0-9][a-z0-9\-]{4,63}[a-z0-9]|[a-z0-9]{4,63})$/;

    constructor() {
        this.httpListener = new Listener().getListener('http');
        this.accountService = new AccountService();
        this.transportEndpoint = new Endpoint();
        this._initializeRoutes();
        this._initializeServer();

        if (Config.get('allow-registration')) {
            logger.warn({message: "Public account registration is enabled"});
        }

        this.apiUrl = Config.get('api-url');
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
                    error: ERROR_BAD_INPUT,
                    field: `content-type: ${ctx.invalid.type.msg}`,
                };
            } else if (ctx.invalid.params) {
                ctx.status = parseInt(ctx.invalid.params.status) || 400;
                ctx.body = {
                    error: ERROR_BAD_INPUT,
                    field: ctx.invalid.params.msg
                };
            } else if (ctx.invalid.body) {
                ctx.status = parseInt(ctx.invalid.body.status) || 400;
                ctx.body = {
                   error: ERROR_BAD_INPUT,
                   field: ctx.invalid.body.msg
                };
            } else {
                ctx.status = 400;
                ctx.body = {
                    error: ERROR_BAD_INPUT,
                };
            }
        };

        const handleAuth = async (ctx, next) => {
            const token = ctx.request.header.authorization ? ctx.request.header.authorization.split(' ')[1] : undefined;
            const accountId = token ? Buffer.from(token, 'base64').toString('utf-8') : undefined;
            if (!token || !accountId) {
                ctx.status = 401;
                ctx.body = {error: ERROR_AUTH_NO_ACCESS_TOKEN};
                return;
            }

            const account = await this.accountService.get(accountId);
            if (account instanceof Account == false) {
                ctx.status = 401;
                ctx.body = {error: ERROR_AUTH_PERMISSION_DENIED};
                return;
            }

            ctx._context = {
                account
            };

            return next();
        };

        const tunnelInfo = (tunnel, baseUrl) => {
            const info = {
                id: tunnel.id,
                connection: {
                    connected: tunnel.state().connected,
                    peer: tunnel.state().peer,
                    connected_at: tunnel.state().connected_at,
                    disconnected_at: tunnel.state().disconnected_at,
                    alive_at: tunnel.state().alive_at,
                },
                endpoints: {},
                ingress: {},
                upstream: {
                    url: tunnel.upstream.url,
                },
                created_at: tunnel.created_at,
            };

            info.endpoints = this.transportEndpoint.getEndpoints(tunnel, baseUrl);

            Object.keys(tunnel.ingress).forEach((k) => {
                const ingress = tunnel.ingress[k];
                if (ingress.enabled) {
                    info.ingress[k] = ingress;
                }
            });

            return info;
        };

        router.route({
            method: ['put', 'patch'],
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
                            alt_names: Router.Joi.array().max(10).items(Router.Joi.string().lowercase().domain()),
                        },
                        sni: {
                            enabled: Router.Joi.boolean(),
                        },
                    },
                    upstream: {
                        url: Router.Joi.string().uri(),
                    },
                    endpoints: {
                        ws: {
                            enabled: Router.Joi.boolean(),
                        },
                        ssh: {
                            enabled: Router.Joi.boolean(),
                        },
                    }
                },
            },
            handler: [handleError, handleAuth, async (ctx, next) => {
                const tunnelId = ctx.params.tunnel_id;
                const account = ctx._context.account;
                const created = await account.createTunnel(tunnelId);
                if (created == false) {
                    ctx.status = 403;
                    ctx.body = {error: ERROR_AUTH_PERMISSION_DENIED};
                    return;
                }

                const body = ctx.request.body;
                const updatedTunnel = await account.updateTunnel(tunnelId, (tunnel) => {
                    tunnel.ingress.http.enabled =
                        body?.ingress?.http?.enabled ?? tunnel.ingress.http.enabled;
                    tunnel.ingress.sni.enabled =
                        body?.ingress?.sni?.enabled ?? tunnel.ingress.sni.enabled;
                    tunnel.ingress.http.alt_names =
                        body?.ingress?.http?.alt_names ?? tunnel.ingress.http.alt_names;
                    tunnel.upstream.url =
                        body?.upstream?.url ?? tunnel.upstream.url;
                    tunnel.endpoints.ws.enabled =
                        body?.endpoints?.ws?.enabled ?? tunnel.endpoints.ws.enabled;
                    tunnel.endpoints.ssh.enabled =
                        body?.endpoints?.ssh?.enabled ?? tunnel.endpoints.ssh.enabled;
                });
                if (updatedTunnel instanceof Tunnel) {
                    ctx.body = tunnelInfo(updatedTunnel, ctx.req._exposrBaseUrl);
                    ctx.status = 200;
                } else if (updatedTunnel instanceof Error) {
                    ctx.status = 400;
                    ctx.body = {error: updatedTunnel.code, details: updatedTunnel.details};
                } else {
                    ctx.status = 403;
                    ctx.body = {error: ERROR_AUTH_PERMISSION_DENIED};
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
                        error: ERROR_TUNNEL_NOT_FOUND,
                    };
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
                        error: ERROR_TUNNEL_NOT_FOUND,
                    };
                } else {
                    ctx.status = 200;
                    ctx.body = tunnelInfo(tunnel, ctx.req._exposrBaseUrl);
                }
            }]
        });

        router.route({
            method: 'post',
            path: '/v1/tunnel/:tunnel_id/disconnect',
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
                const result = await account.disconnectTunnel(tunnelId);
                if (result == undefined) {
                    ctx.status = 404;
                    ctx.body = {
                        error: ERROR_TUNNEL_NOT_FOUND,
                    };
                } else {
                    ctx.status = 200;
                    ctx.body = {
                        result
                    };
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

                const account = await this.accountService.create();
                if (!account) {
                    ctx.status = 503;
                    return;
                }
                ctx.status = 201;
                ctx.body = accountProps(account);
            }]
        });

        router.route({
            method: 'get',
            path: '/v1/account/:account_id/token',
            validate: {
                failure: 400,
                continueOnError: true,
                params: {
                    account_id: Router.Joi.string().required(),
                }
            },
            handler: [handleError, async (ctx, next) => {
                const account = await this.accountService.get(ctx.params.account_id);
                if (!account) {
                    ctx.status = 403;
                    ctx.body = {
                        error: ERROR_AUTH_PERMISSION_DENIED,
                    };
                    return;
                }
                const {accountId, _} = account.getId();
                ctx.status = 201;
                ctx.body = {
                    token: Buffer.from(accountId).toString('base64'),
                };
            }]
        });

        app.use(router.middleware());
        this.appCallback = app.callback();
    }

    _initializeServer() {
        this.httpListener.use('request', {
                logger,
                logBody: true,
                prio: 10,
            }, async (ctx, next) => {

            const baseUrl = this.apiUrl || ctx.baseUrl;
            if (this.apiUrl) {
                const host = ctx?.req?.headers?.host?.toLowerCase();
                if (typeof host !== 'string' || host !== this.apiUrl.host.toLowerCase()) {
                    return next();
                }
            }
            ctx.req._exposrBaseUrl = baseUrl;
            this.appCallback(ctx.req, ctx.res);
        });
    }

    async destroy() {
        await this.accountService.destroy();
    }
}

export default ApiController;