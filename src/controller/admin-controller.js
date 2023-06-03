import { Logger } from '../logger.js';
import KoaController from "./koa-controller.js";

class AdminController extends KoaController {
    _name = 'Admin'

    constructor(opts) {
        const logger = Logger("admin");

        if (!opts.enable) {
            logger.info({
                message: `HTTP Admin disabled`,
            });
            typeof opts.callback === 'function' && process.nextTick(opts.callback);
            return super();
        }

        super({...opts, logger});

        this.appReady = undefined;

        this.setRoutes((router) => {
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
        });
    }

    setReady(ready) {
        ready ??= true;
        this.appReady = ready;
    }

    async _destroy() {
        this.appReady = undefined;
    }
}

export default AdminController;