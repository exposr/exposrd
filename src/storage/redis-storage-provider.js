import assert from 'assert/strict';
import Redis from 'redis';
import { Logger } from '../logger.js';

class RedisStorageProvider {
    constructor(opts) {
        this.logger = Logger("redis-storage");
        const redisUrl = opts.redisUrl;

        if (!redisUrl) {
            throw new Error("No Redis connection string provided");
        }

        this.logger.isTraceEnabled() &&
            this.logger.trace({
                operation: 'new',
                url: redisUrl,
            });

        this._client = Redis.createClient({
            url: redisUrl.href,
        });

        this._client.on('ready', () => {
            this._client.hello()
                .catch(() => {})
                .then((info) => {
                    if (!info) {
                        return;
                    }
                    this.logger.info({
                        message: `connected to redis ${redisUrl}, version: ${info?.version}, client-id: ${info?.id} `,
                        operation: 'connect',
                        server: redisUrl,
                        version: info?.version,
                        clientId: info?.id,
                    });
                    this._client_id = info?.id;
                    this._client_was_ready = true;
                    delete this._client_error;
                });
        });

        this._client.connect()
            .catch((err) => {
                this.logger.error({
                    message: `Failed to connect to ${redisUrl}: ${err.message}`,
                    operation: 'connect',
                });
                typeof opts.callback === 'function' &&
                    process.nextTick(() => opts.callback(new Error(`failed to initialize redis storage provider`)));
            })
            .then(() => {

                this._client.on('error', (err) => {

                    if (this._client_error?.message != err?.message) {
                        this.logger.error({
                            message: `redis client error: ${err.message}`,
                        });
                        this.logger.debug({
                            message: err.message,
                            stack: err.stack
                        });

                        this._client_error = err;
                    }

                    if (!this._client.isReady && this._client_was_ready) {
                        this.logger.warn({
                            message: `disconnected from redis ${redisUrl}: ${err.message}`,
                            operation: 'disconnect',
                            server: redisUrl,
                        });
                        this._client_was_ready = false;
                    }
                });

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

        return this._client.quit().then((res) => {
            this.logger.trace({
                operation: 'destroy',
                message: 'complete',
                res,
            });
        });
    }

    get(key) {
        assert(key !== undefined);

        if (!this._client.isReady) {
            this.logger.error({
                message: `failed to get '${key}': redis client not connected`,
                operation: 'get',
                key,
            });
            return false;
        }

        return this._client.get(key)
            .catch((err) => {
                this.logger.error({
                    message: `failed to get '${key}': ${err.message}`,
                    operation: 'get',
                    key,
                    err
                });
                return false;
            }).then((value) => {
                this.logger.isTraceEnabled() &&
                    this.logger.trace({
                        operation: 'get',
                        key,
                        data,
                    });
                return value;
            });
    }

    mget(keys) {
        assert(keys !== undefined);

        if (!this._client.isReady) {
            this.logger.error({
                message: `failed to mget '${keys.join(",")}': redis client not connected`,
                operation: 'mget',
                keys,
            });
            return false;
        }

        return this._client.MGET(keys)
            .catch((err) => {
                this.logger.error({
                    message: `failed to mget '${keys.join(",")}': ${err.message}`,
                    operation: 'mget',
                    keys,
                    err
                });
                return false;
            }).then((data) => {
                this.logger.isTraceEnabled() &&
                    this.logger.trace({
                        operation: 'mget',
                        keys,
                        data,
                    });
                return data;
            });
    }

    set(key, data, opts = {}) {
        assert(key !== undefined);
        assert(data !== undefined);

        if (!this._client.isReady) {
            this.logger.error({
                message: `failed to set '${key}': redis client not connected`,
                operation: 'set',
                key,
            });
            return false;
        }

        const redis_opts = {};
        if (opts.NX == true) {
            redis_opts.NX = true;
        }
        if (typeof opts.TTL == 'number') {
            redis_opts.EX = opts.TTL;
        }

        return this._client.set(key, data, redis_opts)
            .catch((err) => {
                this.logger.error({
                    message: `failed to set '${key}: ${err.message}`,
                    operation: 'set',
                    key,
                    err
                });
                return false;
            }).then((res) => {
                this.logger.isTraceEnabled() &&
                    this.logger.trace({
                        operation: 'set',
                        opts,
                        key,
                        data,
                        res,
                    });

                return res ? true : false;
            });
    };

    delete(key) {
        assert(key !== undefined);

        if (!this._client.isReady) {
            this.logger.error({
                message: `failed to delete '${key}': redis client not connected`,
                operation: 'delete',
                key,
            });
            return false;
        }

        return this._client.del(key)
            .catch((err) => {
                this.logger.error({
                    message: `failed to delete '${key}: ${err.message}`,
                    operation: 'delete',
                    key,
                    err
                });
                return false;
            }).then((res) => {
                this.logger.isTraceEnabled() &&
                    this.logger.trace({
                        operation: 'delete',
                        opts,
                        key,
                        res,
                    });
                return true;
            });
    }

    list(ns, cursor = 0, count = 10) {
        if (!this._client.isReady) {
            this.logger.error({
                message: `failed to list '${ns}: redis client not connected`,
                operation: 'list',
                ns,
                cursor,
                count,
            });

            return undefined;
        }

        return this._client.scan(cursor, {
            MATCH: `${ns}*`,
            COUNT: count,
        }).catch((err) => {
            this.logger.error({
                message: `failed to list '${ns}: ${err.message}`,
                operation: 'list',
                ns,
                cursor,
                count,
                err,
            });

            return undefined;
        }).then((res) => {
            const nextCursor = res.cursor;
            const keys = res.keys;

            this.logger.isTraceEnabled() && this.logger.trace({
                operation: 'list',
                count,
                cursor,
                nextCursor,
                numResult: keys.length,
            });

            return {
                cursor: nextCursor,
                data: keys,
            }
        });
    }
}

export default RedisStorageProvider;