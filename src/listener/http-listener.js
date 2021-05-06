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

    use(event, callback) {
        if (this.callbacks[event] === undefined) {
            throw new Error("Unknown event " + event);
        }

        this.callbacks[event].push(callback);
    }

    listen(cb) {
        const listenError = (err) => {
            logger.error(`Failed to start http listener: ${err.message}`);
        };
        this.server.once('error', listenError);
        this.server.listen({port: this.opts.port}, (err) => {
            this.server.removeListener('error', listenError);
            cb(err);
        });
    }

    shutdown(cb) {
        this.server.close();
        cb();
    }
}

export default HttpListener;