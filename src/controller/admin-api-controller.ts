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
import ClusterManager from '../cluster/cluster-manager.js';
import Account from '../account/account.js';
import Tunnel from '../tunnel/tunnel.js';

class AdminApiController extends KoaController {
    public readonly _name: string = 'Admin API'

    private apiKey!: string;
    private unauthAccess: boolean = false;
    private accountService!: AccountService;
    private _tunnelService!: TunnelService;
    private _transportService!: TransportService;

    constructor(opts: any) {
        const logger: any = Logger("admin-api");

        super({...opts, logger: logger});
        if (!opts.enable) {
            logger.info({
                message: `HTTP Admin API disabled`,
            });
            return;
        }

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

        const handleAdminAuth: Router.FullHandler = (ctx, next) => {
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

        const accountProps = (account: Account) => {
            return {
                account_id: account.id,
                account_id_hr: AccountService.formatId(account.id),
                tunnels: account.tunnels,
                status: account.status,
                created_at: account.created_at,
                updated_at: account.updated_at,
            }
        };

        const tunnelProps = (tunnel: Tunnel, baseUrl: URL | undefined) => {
            return {
                tunnel_id: tunnel.id,
                account_id: tunnel.account,
                connection: {
                    connected: tunnel.state.connected,
                    connected_at: tunnel.state.connected_at ? new Date(tunnel.state.connected_at).toISOString() : undefined,
                    disconnected_at: tunnel.state.disconnected_at ? new Date(tunnel.state.disconnected_at).toISOString() : undefined,
                    alive_at: tunnel.state.alive_at ? new Date(tunnel.state.alive_at).toISOString() : undefined,
                },
                connections: tunnel.state.connections.map((tc) => {
                    return {
                        connection_id: tc.connection_id,
                        node_id: tc.node,
                        peer: tc.peer,
                        connected: tc.connected,
                        connected_at: tc.connected_at ? new Date(tc.connected_at).toISOString() : undefined,
                        disconnected_at: tc.disconnected_at ? new Date(tc.disconnected_at).toISOString() : undefined,
                        alive_at: tc.alive_at ? new Date(tc.alive_at).toISOString() : undefined,
                    }
                }),
                transport: {
                    ...tunnel.config.transport,
                    ...this._transportService.getTransports(tunnel, baseUrl),
                },
                ingress: tunnel.config.ingress,
                target: tunnel.config.target,
                created_at: tunnel.config.created_at,
                updated_at: tunnel.config.updated_at,
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
                const account: Account | undefined = await this.accountService.get(ctx.params.account_id);
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
                const res = await this.accountService.list(<any>ctx.query.cursor, <any>ctx.query.count, <any>ctx.query.verbose);

                ctx.status = 200;
                ctx.body = {
                    cursor: res.cursor,
                    accounts: res.accounts, 
                };
            }]
        });

        router.route({
            method: 'delete',
            path: '/v1/admin/account/:account_id',
            handler: [handleAdminAuth, async (ctx, next) => {
                ctx.body = {};
                const res = await this.accountService.delete(ctx.params.account_id);
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
                const account: Account | undefined = await this.accountService.disable(ctx.params.account_id, ctx.request.body.disable, ctx.request.body.reason);
                if (!account) {
                    ctx.status = 404;
                } else {
                    ctx.status = 200;
                    ctx.body = accountProps(account);
                }
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
                try {
                    const tunnel = await this._tunnelService.lookup(ctx.params.tunnel_id);
                    ctx.status = 200;
                    ctx.body = tunnelProps(tunnel, this.getBaseUrl(ctx.req));
                } catch (e: any) {
                    if (e.message == 'no_such_tunnel') {
                        ctx.status = 404;
                        ctx.body = {
                            error: ERROR_TUNNEL_NOT_FOUND,
                        };
                    } else {
                        ctx.status = 500;
                        ctx.body = {
                            error: ERROR_TUNNEL_NOT_FOUND,
                            details: e.message,
                        };
                    }
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
                try {
                    const tunnel = await this._tunnelService.lookup(ctx.params.tunnel_id);
                    const result = await this._tunnelService.delete(tunnel.id, tunnel.account);
                    if (result) {
                        ctx.status = 204;
                    } else {
                        ctx.status = 403;
                    }
                } catch (e: any) {
                    ctx.status = 403;
                    ctx.body = {
                        error: ERROR_UNKNOWN_ERROR,
                        details: e.message,
                    }
                }
            }]
        });

        router.route({
            method: 'post',
            path: '/v1/admin/tunnel/:tunnel_id/disconnect',
            validate: {
                failure: 400,
                continueOnError: true,
                params: {
                    tunnel_id: Router.Joi.string().regex(TunnelService.TUNNEL_ID_REGEX).required(),
                }
            },
            handler: [handleAdminAuth, handleError, async (ctx, next) => {
                try {
                    const tunnel = await this._tunnelService.lookup(ctx.params.tunnel_id);
                    const res = await this._tunnelService.disconnect(tunnel.id, tunnel.account);
                    ctx.status = 200;
                    ctx.body = {
                        result: res
                    }

                } catch (e:any) {
                    ctx.status = 403,
                    ctx.body = {
                        details: e.message
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
                const res = await this._tunnelService.list(<any>ctx.query.cursor, <any>ctx.query.count, <any>ctx.query.verbose);

                ctx.status = 200;
                ctx.body = {
                    cursor: res.cursor,
                    tunnels: res.tunnels.map((t) => {
                        return ctx.query.verbose ? tunnelProps(t, this.getBaseUrl(ctx.req)) : t.id;
                    }),
                };
            }]
        });

        router.route({
            method: 'get',
            path: '/v1/admin/cluster',
            validate: {
                failure: 400,
                continueOnError: true,
            },
            handler: [handleAdminAuth, handleError, async (ctx, next) => {
                const now = new Date().getTime();
                const nodes = ClusterManager.getNodes().map((node) => {
                    return {
                        node_id: node.id,
                        host: node.host,
                        ip: node.ip,
                        alive_at: new Date(node.last_ts).toISOString(),
                        alive_age: Math.max(0, now - node.last_ts),
                        is_stale: node.stale,
                    }
                });

                ctx.status = 200;
                ctx.body = {
                    nodes
                };
            }]
        });
    }

    protected async _destroy(): Promise<void> {
        Promise.allSettled([
            this.accountService.destroy(),
            this._tunnelService.destroy(),
            this._transportService.destroy(),
        ]);
    }
}

export default AdminApiController;