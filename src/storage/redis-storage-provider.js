import assert from 'assert/strict';
import Redis from 'redis';
import { Logger } from '../logger.js';
import StorageProvider from './storage-provider.js';
import LockService from '../lock/index.js';

class RedisStorageProvider extends StorageProvider {
    constructor(opts) {
        super();
        this.logger = Logger("redis-storage");
        const redisUrl = opts.url;

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

        Promise.all([
            this._client.connect()
                .catch((err) => {
                    this.logger.error({
                        message: `Failed to connect to ${redisUrl}: ${err.message}`,
                        operation: 'connect',
                    });
                    throw err;
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
                }),
            new Promise((resolve, reject) => {
                const lock = new LockService("redis", {
                    redisUrl,
                    callback: (err) => { err ? reject(err) : resolve(lock) },
                });
            })
            .catch((err) => {
                throw err;
            }).then((lock) => {
                this._lockService = lock;
            })
        ]).catch((err) => {
            typeof opts.callback === 'function' &&
                process.nextTick(() => opts.callback(new Error(`failed to initialize redis storage provider`)));
        }).then(() => {
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

        await this._lockService?.destroy();

        return this._client.quit().then((res) => {
            this.logger.trace({
                operation: 'destroy',
                message: 'complete',
                res,
            });
        });
    }

    async init(ns) {
        return true;
    }

    async get(ns, key, opts) {
        const orig_key = key;
        key = this.compound_key(ns, key);

        if (!this._client.isReady) {
            this.logger.error({
                message: `failed to get '${key}': redis client not connected`,
                operation: 'get',
                key,
            });
            return false;
        }

        let lock;
        if (opts.EX) {
            lock = await this._lockService.lock(key)
            if (!lock) {
                return [null, lock];
            }
        }

        const done = async (value) => {
            let res;
            if (value) {
                res = await this.set(ns, orig_key, value);
            }
            lock.unlock();
            return res;
        };

        return this._client.get(key)
            .catch((err) => {
                this.logger.error({
                    message: `failed to get '${key}': ${err.message}`,
                    operation: 'get',
                    key,
                    err
                });
                lock?.unlock();
                return false;
            }).then((value) => {
                this.logger.isTraceEnabled() &&
                    this.logger.trace({
                        operation: 'get',
                        key,
                        value,
                    });
                return lock ? [value, done] : value;
            });
    }

    mget(ns, keys) {
        keys = this.compound_key(ns, keys);

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

    set(ns, key, data, opts = {}) {
        assert(data !== undefined);
        key = this.compound_key(ns, key);

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

    delete(ns, key) {
        assert(key !== undefined);
        key = this.compound_key(ns, key);

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

        cursor = Number(cursor);
        return this._client.scan(cursor, {
            MATCH: `${ns}:*`,
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
            const keys = res.keys.map((k) => this.key_only(ns, k));

            this.logger.isTraceEnabled() && this.logger.trace({
                operation: 'list',
                count,
                cursor,
                nextCursor,
                numResult: keys.length,
            });

            return {
                cursor: nextCursor != 0 ? String(nextCursor) : null,
                data: keys,
            }
        });
    }
}

export default RedisStorageProvider;