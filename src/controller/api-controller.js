import Router from 'koa-joi-router';
import AccountService from '../account/account-service.js';
import Account from '../account/account.js';
import { Logger } from '../logger.js';
import TransportService from '../transport/transport-service.js';
import TunnelService from '../tunnel/tunnel-service.js';
import Tunnel from '../tunnel/tunnel.js';
import {
    ERROR_AUTH_NO_ACCESS_TOKEN,
    ERROR_AUTH_PERMISSION_DENIED,
    ERROR_BAD_INPUT,
    ERROR_TUNNEL_NOT_FOUND
} from '../utils/errors.js';
import KoaController from './koa-controller.js';

const logger = Logger("api");

class ApiController extends KoaController {

    static TUNNEL_ID_REGEX = /^(?:[a-z0-9][a-z0-9\-]{4,63}[a-z0-9]|[a-z0-9]{4,63})$/;

    constructor(opts) {
        super({
            port: opts.port,
            callback: opts.callback,
            host: opts.url?.host,
            logger,
        });
        this.opts = opts;
        this.accountService = new AccountService();
        this.tunnelService = new TunnelService();
        this.transportService = new TransportService();
        this._initializeRoutes();

        if (opts.allowRegistration) {
            logger.warn({message: "Public account registration is enabled"});
        }
    }

    _initializeRoutes() {
        const router = this.router;

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
                transport: {},
                ingress: {},
                upstream: {
                    url: tunnel.upstream.url,
                },
                created_at: tunnel.created_at,
            };

            info.transport = this.transportService.getTransports(tunnel, baseUrl);

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
                    transport: {
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
                const created = await this.tunnelService.create(tunnelId, account.id);
                if (created == false) {
                    ctx.status = 403;
                    ctx.body = {error: ERROR_AUTH_PERMISSION_DENIED};
                    return;
                }

                const body = ctx.request.body;
                const updatedTunnel = await this.tunnelService.update(tunnelId, account.id, (tunnel) => {
                    tunnel.ingress.http.enabled =
                        body?.ingress?.http?.enabled ?? tunnel.ingress.http.enabled;
                    tunnel.ingress.sni.enabled =
                        body?.ingress?.sni?.enabled ?? tunnel.ingress.sni.enabled;
                    tunnel.ingress.http.alt_names =
                        body?.ingress?.http?.alt_names ?? tunnel.ingress.http.alt_names;
                    tunnel.upstream.url =
                        body?.upstream?.url ?? tunnel.upstream.url;
                    tunnel.transport.ws.enabled =
                        body?.transport?.ws?.enabled ?? tunnel.transport.ws.enabled;
                    tunnel.transport.ssh.enabled =
                        body?.transport?.ssh?.enabled ?? tunnel.transport.ssh.enabled;
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
                const result = await this.tunnelService.delete(tunnelId, account.id);
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
                const tunnel = await this.tunnelService.get(tunnelId, account.id);
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
                const result = await this.tunnelService.disconnect(tunnelId, account.id);
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
                if (!this.opts.allowRegistration) {
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
    }

    async _destroy() {
        return Promise.allSettled([
            this.accountService.destroy(),
            this.tunnelService.destroy(),
            this.transportService.destroy(),
        ]);
    }
}

export default ApiController;