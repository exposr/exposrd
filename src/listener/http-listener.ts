import http from 'http';
import { Logger } from '../logger.js';
import HttpCaptor from '../utils/http-captor.js';
import {
    HTTP_HEADER_FORWARDED,
    HTTP_HEADER_HOST,
    HTTP_HEADER_X_FORWARDED_PORT,
    HTTP_HEADER_X_FORWARDED_PROTO,
    HTTP_HEADER_X_SCHEME
} from '../utils/http-headers.js';
import { Duplex } from 'stream';
import { ListenerBase } from './listener.js';

interface HttpListenerArguments {
    port: number,
}

interface HttpUseOptions {
    logger?: any,
    prio?: number,
    logBody?: boolean,
    host?: string,
}

export type HttpRequestCallback = (ctx: HttpRequestContext, next: () => void) => Promise<void>;
export type HttpUpgradeCallback = (ctx: HttpUpgradeContext, next: () => void) => Promise<void>;
type HttpCallback = (ctx: HttpCallbackContext, next: () => void) => Promise<void>;

interface HttpCallbackOptions {
    logger?: any,
    prio: number,
    host?: string,
    logBody?: boolean,
}

interface _HttpCallback {
    callback: HttpCallback,
    opts: HttpCallbackOptions,
}

export enum HttpRequestType {
    request = "request",
    upgrade = "upgrade"
}

interface HttpCallbackContext {
    req: http.IncomingMessage,
    baseUrl?: URL,
}

interface HttpRequestContext extends HttpCallbackContext {
    res: http.ServerResponse,
}

interface HttpUpgradeContext extends HttpCallbackContext {
    sock: Duplex,
    head: Buffer,
}

export default class HttpListener extends ListenerBase {
    private logger: any;
    private server: http.Server;
    private callbacks: { [ key in HttpRequestType ]: Array<_HttpCallback> };

    constructor(port: number) {
        super(port);
        this.logger = Logger("http-listener");
        this.callbacks = {
            'request': [],
            'upgrade': []
        };

        const server = this.server = http.createServer();

        server.on('request', async (req, res) => {
            const [success, statusCode] = await this.handleRequest(HttpRequestType.request, {req, res});
            if (!success) {
                res.statusCode = statusCode || 500;
                res.end();
            }
        });

        server.on('upgrade', async (req, sock, head) => {
            let [success, statusCode] = await this.handleRequest(HttpRequestType.upgrade, {req, sock, head});
            if (!success) {
                statusCode ??= 500;
                sock.write(`HTTP/${req.httpVersion} ${statusCode} ${http.STATUS_CODES[statusCode]}\r\n`);
                sock.end(`\r\n`);
                sock.destroy();
            }
        });
    }

    protected async _destroy(): Promise<void> {
        return this.close();
    }

    protected async _close(): Promise<void> {
        return new Promise((resolve) => {
            this.server.once('close', () => {
                this.removeHandler(HttpRequestType.request);
                this.removeHandler(HttpRequestType.upgrade);
                this.server.removeAllListeners();
                resolve();
            });
            this.server.close();
            this.server.closeAllConnections();
        });
    }

    private static parseForwarded(forwarded: string): any {
        return Object.fromEntries(forwarded
            .split(';')
            .map(x => x.trim())
            .filter(x => x.length > 0)
            .map(x => x.split('=')
                       .map(y => y.trim())
                )
            )
    }

    private getBaseUrl(req: http.IncomingMessage): URL | undefined {
        const headers = req.headers || {};

        const forwarded = HttpListener.parseForwarded(headers[HTTP_HEADER_FORWARDED] || '');
        const proto = forwarded?.proto
            || headers[HTTP_HEADER_X_FORWARDED_PROTO]
            || headers[HTTP_HEADER_X_SCHEME]
            || 'http';
        const host = (forwarded?.host || headers[HTTP_HEADER_HOST])?.split(':')[0];
        const port = forwarded?.host?.split(':')[1]
            || headers[HTTP_HEADER_X_FORWARDED_PORT]
            || headers[HTTP_HEADER_HOST]?.split(':')[1];

        try {
            return new URL(`${proto}://${host.toLowerCase()}${port ? `:${port}` : ''}`);
        } catch (e) {
            this.logger.isTraceEnabled() && this.logger.trace({e});
            return undefined;
        }
    };

    private async handleRequest(event: HttpRequestType.upgrade, ctx: HttpUpgradeContext): Promise<[boolean, number | undefined]>;
    private async handleRequest(event: HttpRequestType.request, ctx: HttpRequestContext): Promise<[boolean, number | undefined]>;
    private async handleRequest(event: HttpRequestType, ctx: HttpCallbackContext): Promise<[boolean, number | undefined]> {

        const captor = new HttpCaptor({
            request: ctx.req,
            response: (ctx as HttpRequestContext).res,
            opts: {
                limit: 4*1024,
            }
        });

        let statusCode: number | undefined = undefined;
        let next = true;
        let customLogger: any;
        const capture = captor.capture();

        ctx.baseUrl = this.getBaseUrl(ctx.req);
        if (ctx.baseUrl !== undefined) {
            for (const obj of this.callbacks[event]) {
                if (obj.opts.host && obj.opts?.host?.toLowerCase() !== ctx.baseUrl.host) {
                    next = true;
                    continue;
                }
                captor.captureRequestBody = obj.opts?.logBody || false;
                captor.captureResponseBody = obj.opts?.logBody || false;
                try {
                    next = false;
                    await obj.callback(ctx, () => { next = true });
                    if (!next) {
                        customLogger = obj.opts?.logger;
                        break;
                    }
                } catch (e: any) {
                    this.logger.error(e.message);
                    this.logger.debug(e.stack);
                    statusCode = 500;
                }
            }
        } else {
            statusCode = 400;
        }

        customLogger ??= this.logger;
        setImmediate(() => {
            capture.then((res) => {
                if (customLogger === false) {
                    return;
                }
                const logEntry = {
                    operation: 'http-request',
                    request: res.request,
                    response: res.response,
                    client: {
                        ip: res.client.ip,
                        remote: res.client.remoteAddr,
                    },
                    duration: res.duration,
                };
                //customLogger.info(logEntry);
            });
        });
        return [!next, statusCode];
    }

    public use(event: HttpRequestType.request, callback: HttpRequestCallback): this;
    public use(event: HttpRequestType.request, opts: HttpUseOptions, callback: HttpRequestCallback): this;
    public use(event: HttpRequestType.upgrade, callback: HttpUpgradeCallback): this;
    public use(event: HttpRequestType.upgrade, opts: HttpUseOptions, callback: HttpUpgradeCallback): this;
    public use(event: HttpRequestType, opts: any, callback?: any): this {
        if (typeof opts === 'function') {
            callback = opts;
            opts = {};
        }

        if (this.callbacks[event] === undefined) {
            throw new Error("Unknown event " + event);
        }

        opts.prio ??= 2**32;

        const pos = this.callbacks[event].reduce((pos, x) =>  x.opts.prio <= opts.prio ? pos + 1 : pos, 0);
        this.callbacks[event].splice(pos, 0, {callback, opts: {
            logger: opts.logger,
            prio: opts.prio,
            logBody: opts.logBody,
            host: opts.host,
        }});
        return this;
    }

    public removeHandler(event: HttpRequestType.request, callback?: HttpRequestCallback): void;
    public removeHandler(event: HttpRequestType.upgrade, callback?: HttpUpgradeCallback): void;
    public removeHandler(event: HttpRequestType, callback?: any): void {
        this.callbacks[event] = this.callbacks[event].filter(obj => callback != undefined && obj.callback != callback);
    }

    protected async _listen(): Promise<void> {
        return new Promise((resolve, reject) => {
            const listenError = (err: Error) => {
                this.logger.error(`Failed to start http listener: ${err.message}`);
                reject();
            };
            this.server.once('error', listenError);

            this.server.listen({port: this.port}, () => {
                this.server.off('error', listenError);
                resolve();
            });
        });
    }

}