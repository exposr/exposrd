import { Router } from 'koa-joi-router';
import { Logger } from '../logger.js';
import KoaController from "./koa-controller.js";

class AdminController extends KoaController {

    public readonly _name: string = 'Admin'

    public appReady: boolean | undefined;

    constructor(opts: any) {
        const logger: any = Logger("admin");

        super({...opts, logger});
        if (!opts.enable) {
            logger.info({
                message: `HTTP Admin disabled`,
            });
            return;
        }

        this.appReady = undefined;
    }

    public setReady(ready: boolean) {
        ready ??= true;
        this.appReady = ready;
    }

    protected _initializeRoutes(router: Router): void {
        router.route({
            method: 'get',
            path: '/ping',
            handler: async (ctx, next) => {
                ctx.status = this.appReady != undefined ? 200 : 404;
            },
        });

        router.route({
            method: 'get',
            path: '/health',
            handler: async (ctx, next) => {
                ctx.status = this.appReady ? 200 : 404;
            },
        });
    }

    protected async _destroy() {
        this.appReady = undefined;
    }
}

export default AdminController;