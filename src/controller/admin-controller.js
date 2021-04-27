import Koa from 'koa';
import Router from 'koa-joi-router'
import AccountManager from '../account/account-manager.js';

class AdminServer {
    constructor(port) {
        this.appReady = false;
        this.accountManager = new AccountManager();
        const app = this.app = new Koa();
        const router = this.router = Router();
        this._initializeRoutes();
        app.use(router.middleware());
        app.listen(port);
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

        router.route({
            method: 'get',
            path: '/ping',
            handler: async (ctx) => {
                ctx.status = this.appReady ? 200 : 404;
            },
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
            handler: async (ctx, next) => {
                const account = await this.accountManager.create();
                if (account === undefined) {
                    ctx.status = 503;
                    return;
                }
                ctx.status = 201;
                ctx.body = accountProps(account) ;
            }
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
            handler: [handleError, async (ctx, next) => {
                const account = await this.accountManager.get(ctx.params.account_id);
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
            handler: async (ctx, next) => {
                ctx.status = 501;
            }
        });

    }

    setReady() {
        this.appReady = true;
    }

    shutdown(cb) {
        this.app.shutdown(cb);
    }
}

export default AdminServer;