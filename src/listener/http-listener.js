import http from 'http';
import { Logger } from '../logger.js';
import HttpCaptor from '../utils/http-captor.js';

const logger = Logger("http-listener");

const HTTP_HEADER_X_FORWARDED_PROTO = 'x-forwarded-proto';
const HTTP_HEADER_X_FORWARDED_PORT = 'x-forwarded-port';
const HTTP_HEADER_X_SCHEME = 'x-scheme';
const HTTP_HEADER_FORWARDED = 'forwarded';
const HTTP_HEADER_HOST = 'host';
class HttpListener {
    constructor(opts) {
        this.opts = opts;
        const callbacks = this.callbacks = {
            'request': [],
            'upgrade': []
        };

        const parseForwarded = (forwarded) => {
            return Object.fromEntries(forwarded
                .split(';')
                .map(x => x.trim())
                .filter(x => x.length > 0)
                .map(x => x.split('=')
                             .map(y => y.trim())
                    )
                )
        };

        const getBaseUrl = (req) => {
            const headers = req.headers || {};

            const forwarded = parseForwarded(headers[HTTP_HEADER_FORWARDED] || '');
            const proto = forwarded?.proto
                || headers[HTTP_HEADER_X_FORWARDED_PROTO]
                || headers[HTTP_HEADER_X_SCHEME]
                || req.protocol || 'http';
            const host = (forwarded?.host || headers[HTTP_HEADER_HOST])?.split(':')[0];
            const port = forwarded?.host?.split(':')[1]
                || headers[HTTP_HEADER_X_FORWARDED_PORT]
                || headers[HTTP_HEADER_HOST]?.split(':')[1];

            try {
                return new URL(`${proto}://${host}${port ? `:${port}` : ''}`);
            } catch (e) {
                logger.isTraceEnabled() && logger.trace({e});
                return undefined;
            }
        };

        const handleRequest = async (event, ctx) => {
            const captor = new HttpCaptor({
                request: ctx.req,
                response: ctx.res,
                opts: {
                    limit: 4*1024,
                }
            });

            let next;
            let customLogger;
            const capture = captor.capture();

            ctx.baseUrl = getBaseUrl(ctx.req);
            if (ctx.baseUrl !== undefined) {
                for (const obj of this.callbacks[event]) {
                    captor.captureRequestBody = obj.opts?.logBody || false;
                    captor.captureResponseBody = obj.opts?.logBody || false;
                    next = false;
                    await obj.callback(ctx, () => { next = true });
                    if (!next) {
                        customLogger = obj.opts?.logger;
                        break;
                    }
                }
            } else {
                ctx.res.statusCode = 400;
                ctx.res.end();
            }

            customLogger ??= logger;
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
                    customLogger.info(logEntry);
                });
            });
            return !next;
        }

        const server = this.server = http.createServer();
        server.on('request', async (req, res) => {
            if (!await handleRequest('request', {req, res})) {
                res.statusCode = 404;
                res.end();
            }
        });

        server.on('upgrade', async (req, sock, head) => {
            if (!await handleRequest('upgrade', {req, sock, head})) {
                sock.write(`HTTP/${req.httpVersion} 404 Not found\r\n`);
                sock.end();
                sock.destroy();
            }
        });
    }

    getPort() {
        return this.opts.port;
    }

    use(event, opts, callback) {
        if (typeof opts === 'function') {
            callback = opts;
            opts = {};
        }

        if (this.callbacks[event] === undefined) {
            throw new Error("Unknown event " + event);
        }

        opts.prio ??= 2**32;

        const pos = this.callbacks[event].reduce((pos, x) =>  x.opts.prio <= opts.prio ? pos + 1 : pos, 0);
        this.callbacks[event].splice(pos, 0, {callback, opts})
    }

    async listen() {
        const listenError = (err) => {
            logger.error(`Failed to start http listener: ${err.message}`);
        };
        this.server.once('error', listenError);
        return new Promise((resolve, reject) => {
            this.server.listen({port: this.opts.port}, (err) => {
                if (err) {
                    return reject(err);
                }
                this.server.removeListener('error', listenError);
                resolve();
            });
        });
    }

    async destroy() {
        return new Promise((resolve) => {
            this.server.close();
            resolve();
        });
    }
}

export default HttpListener;