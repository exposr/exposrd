import Router from 'koa-joi-router' 
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
    ERROR_TUNNEL_NOT_FOUND,
    ERROR_UNKNOWN_ERROR,
} from '../utils/errors.js';
import KoaController from './koa-controller.js';

class ApiController extends KoaController {

    private opts: any;
    private logger: any;
    private accountService: AccountService;
    private tunnelService: TunnelService;
    private transportService: TransportService;

    constructor(opts: any) {
        const logger = Logger("api");

        super({
            port: opts.port,
            callback: opts.callback,
            host: opts.url?.host,
            logger,
        });
        this.logger = logger;
        this.opts = opts;
        this.accountService = new AccountService();
        this.tunnelService = new TunnelService();
        this.transportService = new TransportService();

        if (opts.allowRegistration) {
            this.logger.warn({message: "Public account registration is enabled"});
        }
    }

    protected _initializeRoutes(router: Router.Router): void {

        const handleError: Router.FullHandler = async (ctx, next) => {
            if (!ctx.invalid) {
                return next();
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

        const handleAuth: Router.FullHandler = async (ctx, next) => {
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

        const tunnelInfo = (tunnel: Tunnel, baseUrl: URL | undefined) => {
            const info = {
                id: tunnel.id,
                connection: {
                    connected: tunnel.state.connected,
                    connections: tunnel.state.alive_connections,
                    connected_at: tunnel.state.connected_at,
                    disconnected_at: tunnel.state.disconnected_at,
                    alive_at: tunnel.state.alive_at,
                },
                transport: {
                    ...this.transportService.getTransports(tunnel, baseUrl),
                },
                ingress: {
                    http: {},
                    sni: {},
                },
                target: {
                    url: tunnel.config.target.url,
                },
                created_at: tunnel.config.created_at,
            };

            if (tunnel.config.ingress['http']?.enabled) {
                info.ingress['http'] = tunnel.config.ingress['http'];
            }
            if (tunnel.config.ingress['sni']?.enabled) {
                info.ingress['sni'] = tunnel.config.ingress['sni'];
            }

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
                    tunnel_id: Router.Joi.string().regex(TunnelService.TUNNEL_ID_REGEX).required(),
                },
                body: {
                    ingress: {
                        http: {
                            enabled: Router.Joi.boolean(),
                            alt_names: Router.Joi.array().max(10).items(Router.Joi.string().lowercase().domain()).allow(null),
                        },
                        sni: {
                            enabled: Router.Joi.boolean(),
                        },
                    },
                    target: {
                        url: Router.Joi.string().uri().allow(null),
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

                let tunnel;
                if (ctx.request.method == 'PUT') {
                    try {
                        tunnel = await this.tunnelService.create(tunnelId, account.id);
                    } catch (e: any) {}

                    try {
                        tunnel = await this.tunnelService.get(tunnelId, account.id);
                    } catch (e:any) {}

                    if (!(tunnel instanceof Tunnel)) {
                        ctx.status = 403;
                        ctx.body = {error: ERROR_AUTH_PERMISSION_DENIED};
                        return;
                    }
                }

                const body = ctx.request.body;

                try {
                    const updatedTunnel = await this.tunnelService.update(tunnelId, account.id, (tunnel) => {
                        tunnel.ingress.http.enabled =
                            body?.ingress?.http?.enabled ?? tunnel.ingress.http.enabled;
                        tunnel.ingress.sni.enabled =
                            body?.ingress?.sni?.enabled ?? tunnel.ingress.sni.enabled;
                        tunnel.ingress.http.alt_names =
                            body?.ingress?.http?.alt_names === null ? undefined :
                                body?.ingress?.http?.alt_names ?? tunnel.ingress.http.alt_names;
                        tunnel.target.url =
                            body?.target?.url === null ? undefined :
                                body?.target?.url ?? tunnel.target.url;
                        tunnel.transport.ws.enabled =
                            body?.transport?.ws?.enabled ?? tunnel.transport.ws.enabled;
                        tunnel.transport.ssh.enabled =
                            body?.transport?.ssh?.enabled ?? tunnel.transport.ssh.enabled;
                    });
                    ctx.body = tunnelInfo(updatedTunnel, this.getBaseUrl(ctx.req));
                    ctx.status = 200;
                } catch (e: any) {
                    if (e.message == 'permission_denied') {
                        ctx.status = 403;
                        ctx.body = {error: ERROR_AUTH_PERMISSION_DENIED};
                    } else {
                        this.logger.error({
                            message: `Failed to update tunnel: ${e.message}`, 
                        });
                        this.logger.debug({
                            stack: e.stack
                        })
                        ctx.status = 500;
                        ctx.body = {error: ERROR_UNKNOWN_ERROR, detailed: e.message};
                    }
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
                    tunnel_id: Router.Joi.string().regex(TunnelService.TUNNEL_ID_REGEX).required(),
                }
            },
            handler: [handleError, handleAuth, async (ctx, next) => {
                const tunnelId = ctx.params.tunnel_id;
                const account = ctx._context.account;
                try {
                    const result = await this.tunnelService.delete(tunnelId, account.id);
                    if (result) {
                        ctx.status = 204;
                    } else {
                        ctx.status = 404;
                        ctx.body = {
                            error: ERROR_TUNNEL_NOT_FOUND,
                        };
                    }

                } catch (e: any) {
                        ctx.status = 404;
                        ctx.body = {
                            error: ERROR_TUNNEL_NOT_FOUND,
                        };
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
                    tunnel_id: Router.Joi.string().regex(TunnelService.TUNNEL_ID_REGEX).required(),
                }
            },
            handler: [handleError, handleAuth, async (ctx, next) => {
                const tunnelId = ctx.params.tunnel_id;
                const account = ctx._context.account;
                try {
                    const tunnel = await this.tunnelService.get(tunnelId, account.id);
                    ctx.status = 200;
                    ctx.body = tunnelInfo(tunnel, this.getBaseUrl(ctx.req));
                } catch (e: any) {
                    ctx.status = 404;
                    ctx.body = {
                        error: ERROR_TUNNEL_NOT_FOUND,
                    };
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
                    tunnel_id: Router.Joi.string().regex(TunnelService.TUNNEL_ID_REGEX).required(),
                }
            },
            handler: [handleError, handleAuth, async (ctx, next) => {
                const tunnelId = ctx.params.tunnel_id;
                const account = ctx._context.account;
                try {
                    const result = await this.tunnelService.disconnect(tunnelId, account.id);
                    ctx.status = 200;
                    ctx.body = {
                        result
                    };
                } catch (e: any) {
                    ctx.status = 404;
                    ctx.body = {
                        error: ERROR_TUNNEL_NOT_FOUND,
                    };
                }
            }]
        });

        const accountProps = (account: Account) => {
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
        await Promise.allSettled([
            this.accountService.destroy(),
            this.tunnelService.destroy(),
            this.transportService.destroy(),
        ]);
    }
}

export default ApiController;