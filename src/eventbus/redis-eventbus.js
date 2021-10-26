import assert from 'assert/strict';
import Redis from 'redis';
import { Logger } from '../logger.js';

class RedisEventBus {
    constructor(opts) {

        this.logger = Logger("redis-eventbus");
        const redisUrl = opts.redisUrl;
        assert(redisUrl != null, "no redisUrl given");

        this.logger.isTraceEnabled() &&
            this.logger.trace({
                operation: 'new',
                url: redisUrl,
            });
        const subscriber = this._subscriber = Redis.createClient({
            url: redisUrl.href,
            connect_timeout: 2147483647,
        });
        subscriber.on('message', (channel, message) => {
            if (channel != 'event') {
                return;
            }
            const obj = JSON.parse(message);
            opts.handler(obj.event, obj.message);
        });
        subscriber.subscribe('event');

        this._publisher = subscriber.duplicate();

        const ready = () => {
            if (!this._subscriber_connected || !this._publisher_connected) {
                return;
            }
            typeof opts.callback === 'function' && process.nextTick(() => opts.callback());
        };

        this._subscriber.once('ready', () => {
            this._subscriber_connected = true;
            ready();
        });
        this._publisher.once('ready', () => {
            this._publisher_connected = true;
            ready();
        });

    }

    async destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.logger.trace({
            operation: 'destroy',
            message: 'initiated'
        });
        this._subscriber.unsubscribe('event');

        const quit = (client) => {
            return new Promise((resolve) => {
                client.quit((res) => {
                    this.logger.trace({
                        id: client.connection_id,
                        operation: 'destroy',
                        message: 'complete',
                        res,
                    });
                    resolve();
                });
            });
        };

        return Promise.allSettled([
            quit(this._publisher),
            quit(this._subscriber)
        ]);
    }

    async publish(event, message) {
        return new Promise((resolve) => {
            this._publisher.publish('event', JSON.stringify({event, message}), (err, num) => {
                this.logger.debug({
                    operation: 'publish',
                    event,
                    num,
                    err,
                    message,
                });
                if (err) {
                    resolve(false);
                }
                resolve(true);
            });
        });
    }
}

export default RedisEventBus;