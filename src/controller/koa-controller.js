import Koa from 'koa';
import Router from 'koa-joi-router';
import Listener from '../listener/index.js';

class KoaController {

    _name = 'controller'

    constructor(opts) {
        if (opts == undefined) {
            return;
        }
        const {port, callback, logger, host, prio} = opts;

        const httpListener = this.httpListener = new Listener().getListener('http', port, { app: new Koa() });
        this._requestHandler = httpListener.use('request', { host, logger, prio, logBody: true }, async (ctx, next) => {
            ctx.req._exposrBaseUrl = ctx.baseUrl;
            if (!await this.appCallback(ctx.req, ctx.res)) {
                return next();
            }
        });

        httpListener.setState({
            app: new Koa(),
            ...httpListener.state,
        });
        this.app = httpListener.state.app;

        this.router = Router();
        this.setRoutes = (initFun) => {
            initFun(this.router);
            this.app.use(this.router.middleware());
        };

        this.appCallback = async (req, res) => {
            await (this.app.callback()(req, res));
            return true;
        };

        this.httpListener.listen()
            .then(() => {
                logger.info({
                    message: `HTTP ${this._name} listening on port ${port}`,
                });
                typeof callback === 'function' && process.nextTick(() => callback());
            })
            .catch((err) => {
                logger.error({
                    message: `Failed to initialize HTTP ${this._name}: ${err.message}`,
                });
                typeof callback === 'function' && process.nextTick(() => callback(err));
            });
 
    }

    async _destroy() {
        return true;
    }

    async destroy() {
        this.httpListener.removeHandler('request', this._requestHandler);
        return Promise.allSettled([
            this.httpListener.destroy(),
            this._destroy(),
        ]);
    }
}

export default KoaController;