import Koa from 'koa';
import Router from 'koa-joi-router'
import AccountService from '../account/account-service.js';
import Config from '../config.js';
import { Logger } from '../logger.js'; const logger = Logger("admin");

class AdminServer {
    constructor(port) {
        this.appReady = false;
        this.apiKey = typeof Config.get('admin-api-key') === 'string' &&
            Config.get('admin-api-key')?.length > 0 ? Config.get('admin-api-key') : undefined;
        this.unauthAccess = this.apiKey === undefined && Config.get('admin-allow-access-without-api-key') === true;
        this.accountService = new AccountService();
        const app = this.app = new Koa();
        const router = this.router = Router();
        this._initializeRoutes();
        app.listen(port);

        if (this.apiKey != undefined) {
            logger.info("Admin API resource enabled with API key");
        } else if (this.unauthAccess) {
            logger.warn("Admin API resource enabled without authentication");
        } else {
            logger.warn("Admin API resource disabled - no API key given");
        }
    }

    _initializeRoutes() {
        const router = this.router;

        this.app.use(async (ctx, next) => {
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

        const handleError = async (ctx, next) => {
            if (!ctx.invalid) {
                return next();
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
            }
        };

        router.route({
            method: 'get',
            path: '/ping',
            handler: async (ctx, next) => {
                ctx.status = this.appReady ? 200 : 404;
            },
        });

        router.route({
            method: 'post',
            path: '/v1/account',
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
            path: '/v1/account/:account_id',
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
                ctx.body = accountProps(account) ;
            }]
        });

        router.route({
            method: 'delete',
            path: '/v1/account/:account_id',
            handler: [handleAdminAuth, async (ctx, next) => {
                ctx.status = 501;
            }]
        });

        this.app.use(router.middleware());
    }

    setReady() {
        this.appReady = true;
    }

    shutdown(cb) {
        this.app.shutdown(cb);
    }
}

export default AdminServer;