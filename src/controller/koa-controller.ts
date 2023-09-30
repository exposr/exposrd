import Koa from 'koa';
import Router, { FullHandler } from 'koa-joi-router';
import Listener from '../listener/index.js';
import HttpListener from '../listener/http-listener.js';
import { IncomingMessage, ServerResponse } from 'http';

abstract class KoaController {

    public readonly _name: string = 'controller'
    private _port!: number;
    private httpListener!: HttpListener;
    private _requestHandler: any;
    private router!: Router.Router;
    private app!: Koa;

    constructor(opts: any) {
        if (opts == undefined) {
            return;
        }
        const {port, callback, logger, host, prio} = opts;

        if (opts?.enable === false) {
            typeof callback === 'function' && process.nextTick(() => callback());
            return;
        }

        this._port = port;

        const useCallback: FullHandler = async (ctx, next) => {
            const setBaseUrl = (req: any, baseUrl: string) => {
                req._exposrBaseUrl = baseUrl;
            };
            setBaseUrl(ctx.req, ctx.baseUrl)
            if (!await this.appCallback(ctx.req, ctx.res)) {
                return next();
            }
        }

        const httpListener = this.httpListener = Listener.acquire('http', port, { app: new Koa() });
        this._requestHandler = httpListener.use('request', { host, logger, prio, logBody: true }, useCallback); 

        httpListener.setState({
            app: new Koa(),
            ...httpListener.state,
        });
        this.app = httpListener.state.app;

        this.router = Router();
        this._initializeRoutes(this.router);
        this.app.use(this.router.middleware());

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

    private async appCallback(req: IncomingMessage, res: ServerResponse<IncomingMessage>): Promise<boolean> {
        await (this.app.callback()(req, res));
        return true;
    }

    protected abstract _initializeRoutes(router: Router.Router): void;

    protected abstract _destroy(): Promise<void>;

    public async destroy() {
        this.httpListener.removeHandler('request', this._requestHandler);
        return Promise.allSettled([
            Listener.release('http', this._port),
            this._destroy(),
        ]);
    }
}

export default KoaController;