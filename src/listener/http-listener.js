import http from 'http';
import ListenerInterface  from './listener-interface.js';
import { Logger } from '../logger.js';
import HttpCaptor from '../utils/http-captor.js';
import {
    HTTP_HEADER_FORWARDED,
    HTTP_HEADER_HOST,
    HTTP_HEADER_X_FORWARDED_PORT,
    HTTP_HEADER_X_FORWARDED_PROTO,
    HTTP_HEADER_X_SCHEME
} from '../utils/http-headers.js';

class HttpListener extends ListenerInterface {
    constructor(opts) {
        super();
        this.logger = Logger("http-listener");
        this.opts = opts;
        this.callbacks = {
            'request': [],
            'upgrade': []
        };
        this.state = opts.state || {};

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
            const headers = req.headers || {};

            const forwarded = parseForwarded(headers[HTTP_HEADER_FORWARDED] || '');
            const proto = forwarded?.proto
                || headers[HTTP_HEADER_X_FORWARDED_PROTO]
                || headers[HTTP_HEADER_X_SCHEME]
                || req.protocol || 'http';
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

        const handleRequest = async (event, ctx) => {
            const captor = new HttpCaptor({
                request: ctx.req,
                response: ctx.res,
                opts: {
                    limit: 4*1024,
                }
            });

            let next = true;
            let customLogger;
            const capture = captor.capture();

            ctx.baseUrl = getBaseUrl(ctx.req);
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
                    } catch (e) {
                        this.logger.error(e);
                        ctx.res.statusCode = 500;
                        ctx.res.end();
                    }
                }
            } else {
                ctx.res.statusCode = 400;
                ctx.res.end();
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
                    customLogger.info(logEntry);
                });
            });
            return !next;
        }

        const server = this.server = http.createServer();
        this._clients = new Set();
        server.on('connection', (sock) => {
            this._clients.add(sock);

            sock.once('close', () => {
                this._clients.delete(sock);
            });
        });

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

    setState(state) {
        this.state = state;
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
        return callback;
    }

    removeHandler(event, callback) {
        this.callbacks[event] = this.callbacks[event].filter(obj => obj.callback != callback);
    }

    async _listen() {
        const listenError = (err) => {
            this.logger.error(`Failed to start http listener: ${err.message}`);
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

    async _destroy() {
        return new Promise((resolve) => {
            this.server.once('close', () => {
                resolve();
            });
            this.server.close();
            this._clients.forEach((sock) => sock.destroy());
        });
    }
}

export default HttpListener;