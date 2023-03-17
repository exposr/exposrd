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
                operation: 'redis_new',
                url: redisUrl,
            });

        this._subscriber = Redis.createClient({
            url: redisUrl.href,
        });
        this._publisher = this._subscriber.duplicate();

        const readyHandler = (client) => {
            const clientProp = `_${client}`;
            const errorProp = `_${client}_error`;
            const wasReadyProp = `_${client}_was_ready`;

            this[clientProp].hello()
                .catch(() => {})
                .then((info) => {
                    if (!info) {
                        return;
                    }
                    this.logger.info({
                        message: `${client} client connected to redis ${redisUrl}, version: ${info?.version}, client-id: ${info?.id} `,
                        operation: 'connect',
                        server: redisUrl,
                        version: info?.version,
                        clientId: info?.id,
                    });
                    this[wasReadyProp] = true;
                    delete this[errorProp];
                });
        };

        const errorHandler = (err, client) => {
            const clientProp = `_${client}`;
            const errorProp = `_${client}_error`;
            const wasReadyProp = `_${client}_was_ready`;

            if (this[errorProp]?.message != err?.message) {
                console.log(err);
                this.logger.error({
                    message: `redis ${client} client error: ${err.message}`,
                });
                this.logger.debug({
                    message: err.message,
                    stack: err.stack
                });
                this[errorProp] = err;
            }

            if (!this[clientProp].isReady && this[wasReadyProp]) {
                this.logger.warn({
                    message: `${client} disconnected from redis ${redisUrl}: ${err.message}`,
                    operation: 'disconnect',
                    server: redisUrl,
                });
                this[wasReadyProp] = false;
            }
        };

        this._subscriber.on('ready', () => {
            const errorProp = `_subscriber_error`;
            const wasReadyProp = `_subscriber_was_ready`;

            if (this._subscriber.isReady && this[wasReadyProp])
                return;

            this.logger.info({
                message: `subscriber client connected to redis ${redisUrl}, subscribed to event stream`,
                operation: 'connect',
                server: redisUrl,
            });

            this[wasReadyProp] = true;
            delete this[errorProp];
        });

        this._publisher.on('ready', () => {
            readyHandler('publisher');
        });

        Promise.all([
            this._subscriber.connect().then(() => {
                this.logger.debug({
                    operation: 'redis_subscriber_ready',
                    url: redisUrl,
                    client: 'subscriber'
                });

                this._subscriber.on('error', (err) => {
                    errorHandler(err, 'subscriber');
                });

                this._subscriber.subscribe('event', (message) => {
                    const obj = JSON.parse(message);
                    opts.handler(obj.event, obj.message);
                });
            }),

            this._publisher.connect().then(() => {
                this.logger.debug({
                    operation: 'redis_publisher_ready',
                    url: redisUrl,
                    client: 'publisher'
                });

                this._publisher.on('error', (err) => {
                    errorHandler(err, 'publisher');
                });
            }),
        ]).catch((err) => {
            this.logger.error({
                message: `failed to connect to ${redisUrl}: ${err.message}`,
                operation: 'connect',
                err,
            });

            typeof opts.callback === 'function' && process.nextTick(() => opts.callback(new Error(`failed to initialize redis pub/sub`)));
        }).then(async () => {

            typeof opts.callback === 'function' && process.nextTick(() => opts.callback());
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

        try {
            await this._subscriber.unsubscribe('event');
        } catch (err) {
            this.logger.error({
                operation: 'destroy',
                msg: 'could not unsubscribe',
                err
            });
        }

        const quit = (client) => {
            return client.quit((res) => {
                this.logger.trace({
                    client: client.name,
                    operation: 'destroy',
                    message: 'complete',
                    res,
                });
            });
        };

        return Promise.allSettled([
            quit(this._publisher),
            quit(this._subscriber)
        ]);
    }

    async publish(event, message) {
        return this._publisher.publish('event', JSON.stringify({event, message}))
            .catch((err) => {
                this.logger.error({
                    message: `failed to publish event ${event}: ${err.message}`,
                    operation: 'publish',
                });
                return false;
            })
            .then((num) => {
                this.logger.debug({
                    operation: 'publish',
                    event,
                    num,
                    message,
                });
                return true;
            });
    }
}

export default RedisEventBus;