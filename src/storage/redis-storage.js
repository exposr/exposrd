import assert from 'assert/strict';
import Redis from 'redis';
import Config from '../config.js';
import { Logger } from '../logger.js';

class RedisStorage {
    constructor(callback) {
        if (RedisStorage.instance instanceof RedisStorage) {
            const redis = RedisStorage.instance._client;
            if (redis.server_info?.redis_version != undefined) {
                process.nextTick(callback);
            } else {
                redis.once('ready', callback);
            }
            return RedisStorage.instance;
        }
        RedisStorage.instance = this;
        this.logger = Logger("redis-storage");
        const redisUrl = Config.get('redis-url');
        if (!redisUrl) {
            throw new Error("No Redis connection string provided");
        }
        this.logger.isTraceEnabled() &&
            this.logger.trace({
                operation: 'redis_new',
                url: redisUrl,
            });
        const redis = this._client = Redis.createClient({
            url: redisUrl.href,
            connect_timeout: 2147483647,
        });
        redis.once('ready', () => {
            process.nextTick(callback);
        });
        redis.on('connect', () => {
            this.logger.info({
                operation: 'redis_connect',
                url: redisUrl,
                version: redis.server_info?.redis_version,
            });
            this.connected = true;
        });
        redis.on('error', (err) => {
            this.logger.error({
                operation: 'redis_error',
                message: err.message,
            });
        });
        redis.on('reconnecting', (obj) => {
            this.logger.info({
                operation: 'redis_reconnecting',
                delay: obj.delay,
                attempt: obj.attempt,
            });
            this.connected = false;
        });
    }

    get(key) {
        assert(key !== undefined);
        if (!this.connected) {
            return false;
        }
        return new Promise((resolve, reject) => {
            this._client.get(key, (err, data) => {
                this.logger.isTraceEnabled() &&
                    this.logger.trace({
                        operation: 'get',
                        key,
                        err,
                        data,
                    });
                if (err) {
                    return resolve(false);
                }
                resolve(data);
            });
        });
    }

    set(key, data, opts = {}) {
        assert(key !== undefined);
        assert(data !== undefined);
        if (!this.connected) {
            return false;
        }
        return new Promise((resolve, reject) => {
            const cb = (err, res) => {
                this.logger.isTraceEnabled() &&
                    this.logger.trace({
                        operation: 'set',
                        opts,
                        key,
                        data,
                        res,
                        err
                    });
                if (err) {
                    resolve(false);
                } else {
                    resolve(data);
                }
            }
            const args = [key, data];
            if (opts.NX) {
                args.push('NX');
            }
            if (typeof opts.TTL == 'number') {
                args.push('EX', `${opts.TTL}`);
            }
            args.push(cb)
            this._client.set(...args);
        });
    };

    delete(key) {
        assert(key !== undefined);
        if (!this.connected) {
            return false;
        }
        return new Promise(resolve => {
            this._client.del(key, (res) => {
                this.logger.isTraceEnabled() &&
                    this.logger.trace({
                        operation: 'delete',
                        key,
                        res
                    });
                resolve(true);
            });
        });
    };

    destroy(cb) {
        this.logger.trace({
            operation: 'destroy',
            message: 'initiated'
        });
        this._client.quit(() => {
            delete RedisStorage.instance;
            process.nextTick(cb);
            logger.trace({
                operation: 'destroy',
                message: 'complete'
            });
        });
    }
}

export default RedisStorage;