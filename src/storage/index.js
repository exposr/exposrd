import assert from 'assert/strict';
import LockService from '../lock/index.js';
import MemoryStorageProvider from './memory-storage-provider.js';
import RedisStorageProvider from './redis-storage-provider.js';
import Serializer from './serializer.js';

class StorageService {
    constructor(type, opts) {
        if (StorageService.instance instanceof StorageService) {
            StorageService.ref++;
            return StorageService.instance;
        }

        assert(type != undefined, "type not given");

        StorageService.ref = 1;
        StorageService.instance = this;

        let clazz;
        switch (type) {
            case 'redis':
                clazz = RedisStorageProvider;
               break;
            case 'none':
            case 'mem':
                clazz = MemoryStorageProvider;
                break;
            default:
                assert.fail(`Unknown storage ${type}`);
        }

        const ready = (err) => {
            typeof opts.callback === 'function' && process.nextTick(() => opts.callback(err));
        };

        Promise.all([
            new Promise((resolve, reject) => {
                const storage = new clazz({
                    ...opts,
                    callback: (err) => { err ? reject(err) : resolve(storage) },
                });
            }),
            new Promise((resolve, reject) => {
                const lock = new LockService(type, {
                    ...opts,
                    callback: (err) => { err ? reject(err) : resolve(lock) },
                });
            })
        ]).catch(async (err) => {
            await this.destroy();
            ready(err);
        }).then((results) => {
            const [storage, lock] = results;
            this._storage = storage;
            this._lockService = lock;
            ready();
        });
    }

    getStorage() {
        assert(this._storage != undefined, "storage not initialized");
        return this._storage
    }

    async destroy() {
        if (--StorageService.ref == 0) {
            await Promise.allSettled([this._storage?.destroy(), this._lockService?.destroy()]);
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
        this._lockService = new LockService();
        this._storage = this._storageService.getStorage();
        this._storage.init(namespace);
    }

    async destroy() {
        return Promise.allSettled[
            this._storageService.destroy(),
            this._lockService.destroy()
        ];
    }

    async read(key, clazz) {
        const data = await this._get(key);
        if (!data) {
            return data;
        }
        if (data instanceof Array) {
            return data.map((d) => {
                return Serializer.deserialize(d, clazz);
            });
        } else {
            return Serializer.deserialize(data, clazz);
        }
    }

    async update(key, clazz, cb, opts = {}) {
        const lock = await this._lockService.lock(this._storage.compound_key(this.ns, key));
        if (!lock) {
            return false;
        }

        const obj = await this.read(key, clazz);
        if (!obj) {
            lock.unlock();
            return false;
        }

        const res = await cb(obj);
        if (res !== true || !lock.locked()) {
            lock.unlock();
            return false;
        }
        const serialized = Serializer.serialize(obj);
        await this._set(key, serialized, opts);
        lock.unlock();
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
            return data.map((d) => { return JSON.parse(d); });
        } else {
            return JSON.parse(data);
        }
    };

    // Returns
    // String(s) on success
    // undefined on not found
    // false on storage error
    async _get(key) {
        if (key instanceof Array) {
            return key.length > 0 ? this._get_many(key) : key;
        } else {
            return this._get_one(key);
        }
    };

    async _get_one(key) {
        return this._storage.get(this.ns, key);
    };

    async _get_many(keys) {
        return this._storage.mget(this.ns, keys);
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
    async delete(key = undefined) {
        if (!key) {
            key = this.key;
        }
        assert(key !== undefined);
        return this._storage.delete(this.ns, key);
    };

    async list(state = undefined, count = 10) {
        let data = [];

        if (state?.data?.length > 0) {
            data = state.data.slice(0, count);
            state.data = state.data.slice(count);
            return {
                cursor: state,
                data
            }
        }

        let cursor = state?.cursor;
        do {
            const requested = count - data.length;
            const res = await this._storage.list(`${this.ns}:`, cursor, requested);
            cursor = res.cursor;
            data.push(...res.data);
        } while (data.length < count && cursor != 0);

        data = data.map((v) => v.slice(v.indexOf(this.ns) + this.ns.length + 1));
        state = {
            cursor,
            data: data.slice(count)
        };

        return {
            cursor: state.cursor > 0 || state.data.length > 0 ? state : null,
            data: data.slice(0, count)
        }
    }
}

export default Storage;