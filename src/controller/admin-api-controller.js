import Router from 'koa-joi-router';
import AccountService from '../account/account-service.js';
import { Logger } from '../logger.js';
import TransportService from '../transport/transport-service.js';
import TunnelService from '../tunnel/tunnel-service.js';
import {
    ERROR_BAD_INPUT,
    ERROR_TUNNEL_NOT_FOUND,
    ERROR_UNKNOWN_ERROR,
} from '../utils/errors.js';
import KoaController from './koa-controller.js';

class AdminApiController extends KoaController {
    _name = 'Admin API'

    constructor(opts) {
        const logger = Logger("admin-api");

        if (!opts.enable) {
            logger.info({
                message: `HTTP Admin API disabled`,
            });
            typeof opts.callback === 'function' && process.nextTick(opts.callback);
            return super();
        }

        super({...opts, logger: logger});
        this.logger = logger;

        this.apiKey = typeof opts.apiKey === 'string' &&
            opts.apiKey?.length > 0 ? opts.apiKey : undefined;
        this.unauthAccess = this.apiKey === undefined && opts.unauthAccess === true;

        this.accountService = new AccountService();
        this._tunnelService = new TunnelService();
        this._transportService = new TransportService();

        if (this.apiKey != undefined) {
            logger.info("Admin API resource enabled with API key");
        } else if (this.unauthAccess) {
            logger.warn("Admin API resource enabled without authentication");
        } else {
            logger.warn("Admin API resource disabled - no API key given");
            return;
        }

        this.setRoutes((router) => this._initializeRoutes(router));
    }

    _initializeRoutes(router) {

        const handleError = async (ctx, next) => {
            if (!ctx.invalid) {
                return next();
            }

            if (ctx.invalid.type) {
                ctx.status = 400;
                ctx.body = {
                    error: ERROR_BAD_INPUT,
                    field:  `content-type: ${ctx.invalid.type.msg}`,
                }
            } else if (ctx.invalid.params) {
                ctx.status = parseInt(ctx.invalid.params.status) || 400;
                ctx.body = {
                    error: ERROR_BAD_INPUT,
                    field: ctx.invalid.params.msg
                }
            } else if (ctx.invalid.query) {
                ctx.status = parseInt(ctx.invalid.query.status) || 400;
                ctx.body = {
                    error: ERROR_BAD_INPUT,
                    field: ctx.invalid.query.msg
                }
            } else if (ctx.invalid.body) {
                ctx.status = parseInt(ctx.invalid.body.status) || 400;
                ctx.body = {
                    error: ERROR_BAD_INPUT,
                    field: ctx.invalid.body.msg
                }
            } else {
                ctx.status = 400;
                ctx.body = {
                    error: ERROR_BAD_INPUT,
                    field: 'unable to determine error'
                }
            }
        };

        const handleAdminAuth = (ctx, next) => {
            if (this.unauthAccess === true)  {
                return next();
            } else if (this.apiKey != undefined) {
                const token = ctx.request.header.authorization ? ctx.request.header.authorization.split(' ')[1] : undefined;
                const apiKey = token ? Buffer.from(token, 'base64').toString('utf-8') : undefined;
                if (this.apiKey === apiKey) {
                    return next();
                } else {
                    ctx.status = 403;
                    return;
                }
            } else {
                ctx.status = 404;
            }
        };

        const accountProps = (account) => {
            const {accountId, formatted} = account.getId();
            return {
                account_id: accountId,
                account_id_hr: formatted,
                tunnels: account.tunnels,
                status: account.status,
                created_at: account.created_at,
                updated_at: account.updated_at,
            }
        };

        const tunnelProps = (tunnel, baseUrl) => {
            return {
                tunnel_id: tunnel.id,
                accound_id: tunnel.account,
                transport: {
                    ...tunnel.transport,
                    ...this._transportService.getTransports(tunnel, baseUrl),
                },
                ingress: tunnel.ingress,
                target: tunnel.target,
                connection: {
                    connected: tunnel.state().connected,
                    peer: tunnel.state().peer,
                    connected_at: tunnel.state().connected_at,
                    disconnected_at: tunnel.state().disconnected_at,
                    alive_at: tunnel.state().alive_at,
                },
                connections: tunnel.state().connections,
                created_at: tunnel.created_at,
                updated_at: tunnel.updated_at,
            }
        };

        router.route({
            method: 'post',
            path: '/v1/admin/account',
            handler: [handleAdminAuth, async (ctx, next) => {
                const account = await this.accountService.create();
                if (account === undefined) {
                    ctx.status = 503;
                    return;
                }
                ctx.status = 201;
                ctx.body = accountProps(account) ;
            }]
        });

        router.route({
            method: 'get',
            path: '/v1/admin/account/:account_id',
            validate: {
                failure: 400,
                continueOnError: true,
                params: {
                    account_id: Router.Joi.string().required(),
                }
            },
            handler: [handleAdminAuth, handleError, async (ctx, next) => {
                const account = await this.accountService.get(ctx.params.account_id);
                if (!account) {
                    ctx.status = 404;
                    ctx.body = {};
                    return;
                }
                ctx.status = 200;
                ctx.body = accountProps(account);
            }]
        });

        router.route({
            method: 'get',
            path: '/v1/admin/account',
            validate: {
                failure: 400,
                continueOnError: true,
                query: {
                    cursor: Router.Joi.number().integer().min(0).optional(),
                    count: Router.Joi.number().integer().min(1).max(100).optional().default(25),
                    verbose: Router.Joi.boolean().default(false),
                }
            },
            handler: [handleAdminAuth, handleError, async (ctx, next) => {
                const res = await this.accountService.list(ctx.query.cursor, ctx.query.count, ctx.query.verbose);

                ctx.status = 200;
                ctx.body = {
                    cursor: res.cursor,
                    accounts: res.accounts.map((a) => { return accountProps(a); }),
                };
            }]
        });

        router.route({
            method: 'delete',
            path: '/v1/admin/account/:account_id',
            handler: [handleAdminAuth, async (ctx, next) => {
                ctx.body = {};
                const res = await this.accountService.delete(ctx.params.account_id);
                if (res === undefined) {
                    ctx.status = 404;
                    return;
                }

                if (res === false) {
                    ctx.status = 500;
                    return;
                }

                ctx.status = 204;
                return;
            }]
        });

        router.route({
            method: 'put',
            path: '/v1/admin/account/:account_id/disable',
            validate: {
                type: 'json',
                maxBody: '64kb',
                failure: 400,
                continueOnError: true,
                params: {
                    account_id: Router.Joi.string().required(),
                },
                body: {
                    disable: Router.Joi.boolean().required(),
                    reason: Router.Joi.string().max(256).optional(),
                }
            },
            handler: [handleAdminAuth, handleError, async (ctx, next) => {
                const account = await this.accountService.disable(ctx.params.account_id, ctx.request.body.disable, ctx.request.body.reason);

                ctx.status = 200;
                ctx.body = accountProps(account);
            }]
        });

        router.route({
            method: 'get',
            path: '/v1/admin/tunnel/:tunnel_id',
            validate: {
                failure: 400,
                continueOnError: true,
                params: {
                    tunnel_id: Router.Joi.string().regex(TunnelService.TUNNEL_ID_REGEX).required(),
                }
            },
            handler: [handleAdminAuth, handleError, async (ctx, next) => {
                const tunnel = await this._tunnelService._get(ctx.params.tunnel_id);
                if (!tunnel) {
                    ctx.body = {
                        error: ERROR_TUNNEL_NOT_FOUND,
                    };
                } else {
                    ctx.status = 200;
                    ctx.body = tunnelProps(tunnel, ctx.req._exposrBaseUrl);
                }
            }]
        });

        router.route({
            method: 'delete',
            path: '/v1/admin/tunnel/:tunnel_id',
            validate: {
                failure: 400,
                continueOnError: true,
                params: {
                    tunnel_id: Router.Joi.string().regex(TunnelService.TUNNEL_ID_REGEX).required(),
                }
            },
            handler: [handleAdminAuth, handleError, async (ctx, next) => {
                const tunnel = await this._tunnelService._get(ctx.params.tunnel_id);
                if (!tunnel) {
                    ctx.body = {
                        error: ERROR_TUNNEL_NOT_FOUND,
                    };
                }
                const result = await this._tunnelService.delete(tunnel.id, tunnel.account);
                if (result === false) {
                    ctx.status = 500;
                    ctx.body = {
                        error: ERROR_UNKNOWN_ERROR,
                    };
                } else {
                    ctx.status = 204;
                }
            }]
        });

        router.route({
            method: 'post',
            path: '/v1/admin/tunnel/:tunnel_id/disconnect/:connection_id?',
            validate: {
                failure: 400,
                continueOnError: true,
                params: {
                    tunnel_id: Router.Joi.string().regex(TunnelService.TUNNEL_ID_REGEX).required(),
                    connection_id: Router.Joi.string().optional()
                }
            },
            handler: [handleAdminAuth, handleError, async (ctx, next) => {
                const tunnel = await this._tunnelService._get(ctx.params.tunnel_id);
                if (!tunnel) {
                    ctx.body = {
                        error: ERROR_TUNNEL_NOT_FOUND,
                    };
                } else {
                    const res = await this._tunnelService._disconnect(tunnel, ctx.params.connection_id);
                    ctx.status = 200;
                    ctx.body = {
                        result: res
                    }
                }
            }]
        });

        router.route({
            method: 'get',
            path: '/v1/admin/tunnel',
            validate: {
                failure: 400,
                continueOnError: true,
                query: {
                    cursor: Router.Joi.number().integer().min(0).optional(),
                    count: Router.Joi.number().integer().min(1).max(100).optional().default(25),
                    verbose: Router.Joi.boolean().default(false),
                }
            },
            handler: [handleAdminAuth, handleError, async (ctx, next) => {
                const res = await this._tunnelService.list(ctx.query.cursor, ctx.query.count, ctx.query.verbose);

                ctx.status = 200;
                ctx.body = {
                    cursor: res.cursor,
                    tunnels: res.tunnels.map((t) => { return ctx.query.verbose ? tunnelProps(t, ctx.req._exposrBaseUrl) : t; }),
                };
            }]
        });

    }

    async _destroy() {
        return Promise.allSettled([
            this.accountService.destroy(),
            this._tunnelService.destroy(),
            this._transportService.destroy(),
        ]);
    }
}

export default AdminApiController;