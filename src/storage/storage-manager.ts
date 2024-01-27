import StorageProvider from "./storage-provider.js";

import MemoryStorageProvider from './memory-storage-provider.js';
import RedisStorageProvider from './redis-storage-provider.js';
import SqliteStorageProvider from './sqlite-storage-provider.js';
import PgsqlStorageProvider, { PgsqlStorageProviderOpts } from './pgsql-storage-provider.js';
import assert from "assert";

export type StorageManagerOpts = {
    pgsql?: PgsqlStorageProviderOpts;
}

export default class StorageManager {

    private static _storage: StorageProvider;

    public static async init(url: URL, opts?: StorageManagerOpts): Promise<void> {

        try {
            await new Promise((resolve, reject) => {
                const callback = (err?: Error) => {
                    err ? reject(err) : resolve(undefined);
                };

                switch (url.protocol) {
                    case 'memory:':
                        this._storage = new MemoryStorageProvider({
                            url,
                            callback,
                        });
                        break;
                    case 'postgres:':
                        this._storage = new PgsqlStorageProvider({
                            url,
                            callback,
                            ...opts?.pgsql,
                        });
                        break;
                    case 'redis:':
                        this._storage = new RedisStorageProvider({
                            url,
                            callback,
                        });
                        break;
                    case 'sqlite:':
                        this._storage = new SqliteStorageProvider({
                            url,
                            callback,
                        });
                        break;
                    default:
                        assert.fail(`Unknown storage ${url.protocol}`);
                }
            });
        } catch (e: any) {
            throw e;
        }
    }

    public static async close(): Promise<void> {
        this._storage.destroy();
    }

    public static getStorage(): StorageProvider {
        return this._storage;
    }
}