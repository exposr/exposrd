import http from 'http';
import { Logger } from '../logger.js';

const logger = Logger("http-listener");

class HttpListener {
    constructor(opts) {
        this.opts = opts;
        const callbacks = this.callbacks = {
            'request': [],
            'upgrade': []
        };

        const handleRequest = async (event, ctx) => {
            let next;
            for (const cb of this.callbacks[event]) {
                next = false;
                await cb(ctx, () => { next = true });
                if (!next) {
                    break;
                }
            }
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

    use(event, callback) {
        if (this.callbacks[event] === undefined) {
            throw new Error("Unknown event " + event);
        }

        this.callbacks[event].push(callback);
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