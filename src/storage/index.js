import assert from 'assert/strict';
import Serializer from './serializer.js';
import MemoryStorageProvider from './memory-storage-provider.js';
import RedisStorageProvider from './redis-storage-provider.js';
import SqliteStorageProvider from './sqlite-storage-provider.js';
import PgsqlStorageProvider from './pgsql-storage-provider.js';

class StorageService {
    constructor(opts) {
        if (StorageService.instance instanceof StorageService) {
            StorageService.ref++;
            return StorageService.instance;
        }

        const url = opts?.url;
        assert(url instanceof URL, "No connection URL was given");

        StorageService.ref = 1;
        StorageService.instance = this;

        let clazz;
        let provider_opts = {};
        switch (url.protocol) {
            case 'redis:':
                clazz = RedisStorageProvider;
                break;
            case 'sqlite:':
                clazz = SqliteStorageProvider;
                break;
            case 'postgres:':
                clazz = PgsqlStorageProvider;
                provider_opts = opts?.pgsql;
                break;
            case 'memory:':
                clazz = MemoryStorageProvider;
                break;
            default:
                assert.fail(`Unknown storage ${type}`);
        }

        const ready = (err) => {
            typeof opts.callback === 'function' && process.nextTick(() => opts.callback(err));
        };

        new Promise((resolve, reject) => {
            const storage = new clazz({
                url,
                ...provider_opts,
                callback: (err) => { err ? reject(err) : resolve(storage) },
            });
        }).catch(async (err) => {
            await this.destroy();
            ready(err);
        }).then(result => {
            this._storage = result;
            ready();
        });

    }

    getStorage() {
        assert(this._storage != undefined, "storage not initialized");
        return this._storage
    }

    async destroy() {
        if (--StorageService.ref == 0) {
            await this._storage?.destroy();
            this.destroyed = true;
            delete this._storage;
            delete StorageService.instance;
        }
    }
}

export { StorageService };

class Storage {
    constructor(namespace) {
        this.ns = namespace;
        this._storageService = new StorageService();
        this._storage = this._storageService.getStorage();
        this._storage.init(namespace);
    }

    async destroy() {
        await this._storageService.destroy()
    }

    async read(key, clazz, opts = {}) {
        let data, lock;
        const result = await this._get(key, opts);
        if (opts.EX) {
            [data, lock] = result;
            if (!lock) {
                return false;
            }
        } else {
            data = result;
            if (!data) {
                return data;
            }
        }

        if (data instanceof Array) {
            data = data.map((d) => {
                return Serializer.deserialize(d, clazz);
            });
        } else {
            data = Serializer.deserialize(data, clazz);
        }
        return opts.EX ? [data, lock] : data;
    }

    async update(key, clazz, cb, opts = {}) {
        const result = await this.read(key, clazz, { EX: true });
        if (!result) {
            return false;
        }
        const [obj, done] = result;

        let error;
        let res = false;
        try {
            res = await cb(obj);
        } catch (e) {
            error = e;
        }

        if (res !== true) {
            done();
            if (error) {
                throw error;
            }
            return false;
        }
        const serialized = Serializer.serialize(obj);
        await done(serialized);
        return obj;
    }

    async create(key, obj, opts = { NX: true, TTL: undefined }) {
        const serialized = Serializer.serialize(obj);
        const res = await this._set(key, serialized, opts);
        if (!res) {
            return res;
        }
        return obj;
    }

    async get(key) {
        const data = await this._get(key);
        if (!data) {
            return data;
        }
        if (data instanceof Array) {
            return data.map((d) => { return typeof d == 'object' ? d : JSON.parse(d); });
        } else {
            return typeof data == 'object' ? data : JSON.parse(data);
        }
    };

    // Returns
    // String(s) on success
    // undefined on not found
    // false on storage error
    async _get(key, opts = {}) {
        if (key instanceof Array) {
            return key.length > 0 ? this._get_many(key, opts) : null;
        } else {
            return this._get_one(key, opts);
        }
    };

    async _get_one(key, opts) {
        return this._storage.get(this.ns, key, opts);
    };

    async _get_many(keys, opts) {
        return this._storage.mget(this.ns, keys, opts);
    };

    async set(key, data, opts = {}) {
        return this._set(key, JSON.stringify(data), opts);
    }

    // Returns
    // String on success
    // false on storage error
    async _set(key, data, opts) {
        return this._storage.set(this.ns, key, data, opts);
    }

    // Returns
    // True if deleted
    // undefined if not found
    // False on storage error
    async delete(key) {
        if (!key) {
            key = this.key;
        }
        assert(key !== undefined);
        return this._storage.delete(this.ns, key);
    };

    async list(state = undefined, count = 10) {
        let data = [];

        if (state?.queue?.length > 0) {
            return {
                cursor: state.cursor,
                queue: state.queue?.slice(count),
                data: state.queue?.slice(0, count)
            }
        }

        let cursor = typeof state == 'string' ? state : state?.cursor;
        cursor = cursor != undefined ? Buffer.from(cursor, 'base64url').toString('utf-8') : undefined;
        do {
            const requested = count - data.length;
            const res = await this._storage.list(this.ns, cursor, requested);
            cursor = res.cursor;
            data.push(...res.data);
        } while (data.length < count && cursor != null);

        return {
            cursor: cursor ? Buffer.from(cursor).toString('base64url') : null,
            queue: data.slice(count),
            data: data.slice(0, count),
        };
    }
}

export default Storage;