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

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.connected = false;
        this.logger.trace({
            operation: 'destroy',
            message: 'initiated'
        });
        return new Promise((resolve) => {
            this._client.quit((res) => {
                delete RedisStorage.instance;
                this.logger.trace({
                    operation: 'destroy',
                    message: 'complete',
                    res,
                });
                resolve();
            });
        });
    }

    list(ns, cursor, count = 10) {
        if (this.destroyed) {
            return {
                cursor: 0,
                data: [],
            };
        }

        return new Promise((resolve) => {
            this._client.scan(cursor, 'MATCH', `${ns}*`, 'COUNT', count, (err, res) => {
                let nextCursor;
                let keys;
                if (!err) {
                    nextCursor = Number.parseInt(res[0]);
                    keys = res[1];
                }
                this.logger.isTraceEnabled() && this.logger.trace({
                    operation: 'list',
                    count,
                    cursor,
                    nextCursor,
                    numResult: keys.length,
                    err,
                });
                if (err) {
                    return resolve(undefined);
                }
                resolve({
                    cursor: nextCursor,
                    data: keys,
                })
            })
        });
    }
}

export default RedisStorage;