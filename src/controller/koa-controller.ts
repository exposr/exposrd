import { strict as assert } from 'assert';
import Koa from 'koa';
import Router from 'koa-joi-router';
import Listener from '../listener/listener.js';
import HttpListener, { HttpRequestCallback, HttpRequestType } from '../listener/http-listener.js';
import { IncomingMessage, ServerResponse } from 'http';

abstract class KoaController {

    public readonly _name: string = 'controller'
    private _port!: number;
    private httpListener!: HttpListener;
    private _requestHandler!: HttpRequestCallback;
    private router!: Router.Router;
    private app!: Koa;

    constructor(opts: any) {
        assert(opts != undefined);
        const {port, callback, logger, host, prio} = opts;

        if (opts?.enable === false) {
            typeof callback === 'function' && process.nextTick(() => callback());
            return;
        }

        this._port = port;

        const useCallback: HttpRequestCallback = this._requestHandler = async (ctx, next) => {
            const setBaseUrl = (req: any, baseUrl: URL | undefined) => {
                req._exposrBaseUrl = baseUrl;
            };
            setBaseUrl(ctx.req, ctx.baseUrl)
            if (!await this.appCallback(ctx.req, ctx.res)) {
                return next();
            }
        }

        const httpListener = this.httpListener = Listener.acquire(HttpListener, port);
        httpListener.use(HttpRequestType.request, { host, logger, prio, logBody: true }, useCallback);

        this.app = new Koa();
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

    public async destroy(): Promise<void> {
        this.httpListener?.removeHandler(HttpRequestType.request, this._requestHandler);
        await Promise.allSettled([
            Listener.release(this._port),
            this._destroy(),
        ]);
    }

    protected getBaseUrl(req: IncomingMessage): URL | undefined {
        return ((req as any)._exposrBaseUrl as (URL | undefined));
    }
}

export default KoaController;