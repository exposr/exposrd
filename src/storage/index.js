import assert from 'assert/strict';
import Config from '../config.js';
import LockService from '../lock/index.js';
import InMemoryStorage from './inmemory-storage.js';
import RedisStorage from './redis-storage.js';
import Serializer from './serializer.js';

class Storage {
    constructor(namespace, opts = {}) {
        const ready = () => {
            opts.callback && process.nextTick(opts.callback);
        };

        if (Config.get('redis-url') != undefined) {
            this.storage = new RedisStorage(ready);
        } else {
            this.storage = new InMemoryStorage(ready);
        }
        this.lockService = new LockService();
        this.ns = namespace;
    }

    async destroy() {
        await Promise.all([this.storage.destroy(), this.lockService.destroy()]);
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
        const lock = await this.lockService.lock(this._key(key));
        if (!lock) {
            return false;
        }

        const obj = await this.read(key, clazz);
        if (!obj) {
            lock.unlock();
            return false;
        }

        const res = await cb(obj);
        if (res === false) {
            lock.unlock();
            return false;
        }
        const serialized = Serializer.serialize(obj);
        await this._set(key, serialized, opts)
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
        return this.storage.get(this._key(key));
    };

    async set(key, data, opts = {}) {
        return this._set(key, JSON.stringify(data), opts);
    }

    // Returns
    // String on success
    // false on storage error
    async _set(key, data, opts) {
        return this.storage.set(this._key(key), data, opts);
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
        this.storage.delete(this._key(key));
    };
}

export default Storage;