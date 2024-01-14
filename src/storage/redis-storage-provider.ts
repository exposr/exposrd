import Redis, { RedisClientType, SetOptions } from 'redis';
import { Logger } from '../logger.js';
import StorageProvider, { AtomicValue, StorageErrorNotFound, StorageProviderError, StorageProviderListResult, StorageProviderOpts } from './storage-provider.js';
import LockService from '../lock/index.js';

export type RedisStorageProviderOpts = {};
type _RedisStorageProviderOpts = StorageProviderOpts & RedisStorageProviderOpts;

class RedisStorageProvider extends StorageProvider {
    private logger: any;
    private _lockService!: LockService;
    private _client: RedisClientType;
    private _client_id: number | undefined;
    private _client_error: Error | undefined;
    private _client_was_ready: boolean = false;

    constructor(opts: _RedisStorageProviderOpts) {
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
                    callback: (err: Error) => { err ? reject(err) : resolve(lock) },
                });
            })
            .catch((err) => {
                throw err;
            }).then((lock) => {
                this._lockService = <LockService>lock;
            })
        ]).catch((err) => {
            typeof opts.callback === 'function' &&
                process.nextTick(() => opts.callback(new Error(`failed to initialize redis storage provider`)));
        }).then(() => {
            typeof opts.callback === 'function' && process.nextTick(() => opts.callback());
        });
    }

    async _destroy(): Promise<void> {
        this.logger.trace({
            operation: 'destroy',
            message: 'initiated'
        });

        await this._lockService?.destroy();
        await this._client.quit().then((res) => {
            this.logger.trace({
                operation: 'destroy',
                message: 'complete',
                res,
            });
        });
    }

    async _init(ns: string): Promise<void> {
    }

    public async set(ns: string, key: string, value: string, ttl?: number): Promise<boolean> {
        const compound_key = this.compound_key(ns, key);

        if (!this._client.isReady) {
            throw new StorageProviderError(ns, key, new Error('redis client not connected'));
        }

        const redis_opts: SetOptions = {
            NX: true,
        };

        if (ttl !== undefined) {
            redis_opts.EX = ttl;
        }

        try {
            const res = await this._client.set(compound_key, value, redis_opts);
            return res ? true : false; 
        } catch (e: any) {
            throw new StorageProviderError(ns, key, e);
        }
    }

    public async put(ns: string, key: string, value: string, ttl?: number): Promise<true> {
        const compound_key = this.compound_key(ns, key);

        if (!this._client.isReady) {
            throw new StorageProviderError(ns, key, new Error('redis client not connected'));
        }

        const redis_opts: SetOptions = {};
        if (ttl !== undefined) {
            redis_opts.EX = ttl;
        }

        try {
            const res = await this._client.set(compound_key, value, redis_opts);
            return true;
        } catch (e: any) {
            throw new StorageProviderError(ns, key, e);
        }
    }

    public async get(ns: string, key: string): Promise<string> {
        const compound_key = this.compound_key(ns, key);

        if (!this._client.isReady) {
            throw new StorageProviderError(ns, key, new Error('redis client not connected'));
        }

        try {
            const res = await this._client.get(compound_key);
            if (res === null) {
                throw new StorageErrorNotFound(ns, key);
            }
            return res;
        } catch (e: any) {
            if (e instanceof StorageErrorNotFound) {
                throw e;
            } else {
                throw new StorageProviderError(ns, key, e);
            }
        }
    }

    public async get_multi(ns: string, keys: Array<string>): Promise<Array<string | null>> {
        const compound_keys = this.compound_key(ns, keys);

        if (!this._client.isReady) {
            throw new StorageProviderError(ns, new Error('redis client not connected'));
        }

        try {
            const res = await this._client.MGET(compound_keys);
            return res;
        } catch (e: any) {
            throw new StorageProviderError(ns, e);
        }
    }

    public async get_and_set(ns: string, key: string): Promise<AtomicValue> {
        const compound_key = this.compound_key(ns, key);

        if (!this._client.isReady) {
            throw new StorageProviderError(ns, new Error('redis client not connected'));
        }
        
        const lock = await this._lockService.lock(key)
        if (!lock) {
            throw new StorageProviderError(ns, key, new Error('failed_to_lock_key'));
        }

        try {
            const value = await this._client.get(compound_key)
            if (value === null) {
                throw new StorageErrorNotFound(ns, key);
            }
            return {
                value,
                release: async (new_value?: string, new_ttl?: number) => {
                    if (new_value != undefined) {
                        await this.put(ns, key, new_value, new_ttl);
                    }
                    lock.unlock();
                    return true;
                }
            }
        } catch (e: any) {
            lock.unlock();
            if (e instanceof StorageErrorNotFound) {
                throw e;
            } else {
                throw new StorageProviderError(ns, key, e);
            }
        }
    }

    public async delete(ns: string, key: string): Promise<true> {
        const compound_key = this.compound_key(ns, key);

        if (!this._client.isReady) {
            throw new StorageProviderError(ns, key, new Error('redis client not connected'));
        }

        try {
            const res = await this._client.del(compound_key);
            if (res === 0) {
                throw new StorageErrorNotFound(ns, key);
            }
            return true;
        } catch (e: any) {
            if (e instanceof StorageErrorNotFound) {
                throw e;
            } else {
                throw new StorageProviderError(ns, key, e);
            }
        }
    }

    public async list(ns: string, cursor: string | undefined, count: number): Promise<StorageProviderListResult> {
        if (!this._client.isReady) {
            throw new StorageProviderError(ns, new Error('redis client not connected'));
        }

        const scanCursor = cursor ? Number(cursor) : 0;
        try {
            const res = await this._client.scan(scanCursor, {
                MATCH: `${ns}:*`,
                COUNT: count,
            });

            const keys = res.keys.map((key) => this.key_only(ns, key));
            const nextCursor = res.cursor;
            return {
                cursor: nextCursor != 0 ? String(nextCursor) : null,
                keys
            };
        } catch (e: any) {
            throw new StorageProviderError(ns, e);
        }
    }
}

export default RedisStorageProvider;