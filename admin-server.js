import Koa from 'koa';
import Router from 'koa-router';

class AdminServer {
    constructor(port) {
        this.appReady = false;
        const app = this.app = new Koa();
        const router = this.router = new Router();
        this._initializeRoutes();
        app.use(router.routes());
        app.use(router.allowedMethods());
        if (port != undefined) {
            app.listen(port);
        }
    }

    _initializeRoutes() {
        this.router.get('/ping', async (ctx) => {
            ctx.status = this.appReady ? 200 : 404;
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