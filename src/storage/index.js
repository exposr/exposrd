import assert from 'assert/strict';
import LockService from '../lock/index.js';
import InMemoryStorage from './inmemory-storage.js';
import RedisStorage from './redis-storage.js';
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

        const ready = (err) => {
            typeof opts.callback === 'function' && opts.callback(err);
        };

        switch (type) {
            case 'redis':
                this._storage = new RedisStorage({
                    callback: ready,
                    ...opts,
                });
                break;
            case 'mem':
                this._storage = new InMemoryStorage({
                    callback: ready,
                    ...opts,
                });
                break;
            default:
                assert.fail(`Unknown storage ${type}`);
        }

        this._lockService = new LockService(type, opts);
    }

    getStorage() {
        assert(this._storage != undefined, "storage not initialized");
        return this._storage
    }

    async destroy() {
        if (--StorageService.ref == 0) {
            await Promise.all([this._storage.destroy(), this._lockService.destroy()]);
            this.destroyed = true;
            delete this._storage;
            delete Storage.instance;
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
    }

    async destroy() {
        return Promise.allSettled[
            this._storageService.destroy(),
            this._lockService.destroy()
        ];
    }

    _key(key) {
        assert(key !== undefined);
        return `${this.ns}:${key}`;
    }

    async read(key, clazz) {
        const str = await this._get(key);
        if (!str) {
            return str;
        }
        return Serializer.deserialize(str, clazz);
    }

    async update(key, clazz, cb, opts = {}) {
        const lock = await this._lockService.lock(this._key(key));
        if (!lock) {
            return false;
        }

        const obj = await this.read(key, clazz);
        if (!obj) {
            lock.unlock();
            return false;
        }

        const res = await cb(obj);
        if (res !== true) {
            lock.unlock();
            return res;
        }
        const serialized = Serializer.serialize(obj);
        await this._set(key, serialized, opts);
        lock.unlock();
        return obj;
    }

    async create(key, obj, opts = { NX: true }) {
        const serialized = Serializer.serialize(obj);
        await this._set(key, serialized, opts);
        return obj;
    }

    async get(key) {
        const data = await this._get(key);
        if (!data) {
            return data;
        }
        return JSON.parse(data);
    };

    // Returns
    // String on success
    // undefined on not found
    // false on storage error
    async _get(key) {
        return this._storage.get(this._key(key));
    };

    async set(key, data, opts = {}) {
        return this._set(key, JSON.stringify(data), opts);
    }

    // Returns
    // String on success
    // false on storage error
    async _set(key, data, opts) {
        return this._storage.set(this._key(key), data, opts);
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
        this._storage.delete(this._key(key));
    };

    async list(cursor = 0, count = 10) {
        const res = await this._storage.list(`${this.ns}:`, cursor, count);
        return {
            cursor: res.cursor,
            data: res.data.map((v) => v.slice(v.indexOf(this.ns) + this.ns.length + 1)),
        }
    }
}

export default Storage;