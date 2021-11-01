import { Logger } from '../logger.js';
import KoaController from "./koa-controller.js";

const logger = Logger("admin");
class AdminController extends KoaController {
    _name = 'Admin'

    constructor(opts) {

        if (!opts.enable) {
            logger.info({
                message: `HTTP Admin disabled`,
            });
            typeof opts.callback === 'function' && process.nextTick(opts.callback);
            return super();
        }

        super(opts.port, opts.callback, logger);

        this.appReady = false;

        this.router.route({
            method: 'get',
            path: '/ping',
            handler: async (ctx, next) => {
                ctx.status = this.appReady ? 200 : 404;
            },
        });
    }

    setReady() {
        this.appReady = true;
    }

    async _destroy() {
        this.appReady = false;
    }
}

export default AdminController;