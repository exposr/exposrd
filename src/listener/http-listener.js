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
            for (const cb of this.callbacks[event]) {
                let next = false;
                await cb(ctx, () => { next = true });
                if (!next) {
                    break;
                }
            }
        }

        const server = this.server = http.createServer();
        server.on('request', async (req, res) => {
            handleRequest('request', {req, res});
        });

        server.on('upgrade', async (req, sock, head) => {
            handleRequest('upgrade', {req, sock, head})
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