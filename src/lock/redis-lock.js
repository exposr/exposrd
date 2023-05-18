import Redis from 'redis';
import Redlock from 'redlock';
import { Logger } from '../logger.js';

class RedisLock {
    constructor(opts) {
        const redisUrl = opts.redisUrl;

        const redis = this._redisClient = Redis.createClient({
            url: redisUrl.href,
            legacyMode: true,
        });

        this.logger = Logger("redis-lock");

        redis.connect()
            .catch((err) => {
                this.logger.error({
                    operation: 'redis_error',
                    message: `failed to connect to ${redisUrl}: ${err.message}`,
                    err,
                });
                typeof opts.callback === 'function' && process.nextTick(() => opts.callback(err));
            }).then(() => {
                redis.on('error', (err) => {
                    this.logger.error({
                        operation: 'redis_error',
                        message: err.message,
                        err
                    });
                });
                this.redlock = new Redlock([redis], {
                    retryDelay: 200,
                    retryCount: 25,
                });

                this.redlock.on("clientError", (err) => {
                    this.logger.debug({
                        operation: 'redlock',
                        message: `redis redlock error: ${err.message}`,
                        stack: err.stack,
                    });
                });

                typeof opts.callback === 'function' && process.nextTick(() => opts.callback());
            });
    }

    async destroy() {
        this.destroyed = true;
        await this._redisClient.disconnect()
            .catch((err) => {
                this.logger.error({
                    operation: 'redlock',
                    message: `failed to disconnect redlock: ${err.message}`,
                });
            });
    }

    async lock(resource) {
        const leaseTime = 1000;
        return this.redlock.acquire([resource], leaseTime)
            .catch((err) => {
                this.logger.error({
                    message: `failed to acquire lock on ${resource}: ${err.message}`,
                    operation: 'redlock',
                });
                return undefined;
            }).then((lock) => {
                this.logger.isTraceEnabled() &&
                    this.logger.trace({
                        operation: 'redlock',
                        resource,
                        ttl
                    });

                return new LockWrapper(this.redlock, lock, resource, leaseTime, this.logger);
            });
    }
}

class LockWrapper {
    constructor(redlock, lock, resource, leaseTime, logger) {
        this.logger = logger;
        this.redlock = redlock;
        this.lock = lock;
        this.resource = resource;
        this.lock_active = true;

        const extend = () => {
            this.redlock.extend(lock, leaseTime)
                .catch((err) => {
                    this.lock_active = false;
                    this.logger.debug({
                        message: `failed to extend lock on ${this.resource}: ${err.message}`,
                        operation: 'redlock',
                    });
                })
                .then(() => {
                    this.logger.debug({
                        message: `lock on ${this.resource} extended`,
                        operation: 'redlock',
                    });

                    this.extendTimer = setTimeout(extend, leaseTime/2);
                });
        };

        this.extendTimer = setTimeout(extend, leaseTime/2);
    }

    unlock() {
        this.lock_active = false;
        clearTimeout(this.extendTimer)
        return this.lock.unlock()
            .catch((err) => {
                this.logger.debug({
                    message: `redlock unlock failed on resource ${this.resource}: ${err.message}`,
                    operation: 'redlock',
                });
            });
    }

    active() {
        return this.lock_active;
    }

};

export default RedisLock;