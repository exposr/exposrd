import InMemoryStorage from './inmemory-storage.js';
import RedisStorage from './redis-storage.js';
import Config from '../config.js'
import Serializer from './serializer.js';
import assert from 'assert/strict';

class Storage {
    constructor(namespace, opts = {}) {
        const storageType = Config.get('storage');

        const ready = () => {
            opts.callback && process.nextTick(opts.callback);
        };

        if (storageType == 'memory') {
            this.storage = new InMemoryStorage(ready);
        } else if (storageType == 'redis') {
            this.storage = new RedisStorage(ready);
        } else {
            throw new Error(`Unknown storage ${storageType}`);
        }
        this.ns = namespace;
    }

    _key(key) {
        assert(key !== undefined);
        return `${this.ns}:${key}`;
    }

    async read(key, clazz) {
        const str = await this.get(key);
        if (!str) {
            return str;
        }
        return Serializer.deserialize(str, clazz);
    }

    async update(key, clazz, cb) {
        // TODO multi-node: lock
        const obj = await this.read(key, clazz);
        const res = await cb(obj);
        if (res === false) {
            // TODO multi-node: unlock
            return false;
        }
        const serialized = Serializer.serialize(obj);
        await this.set(key, serialized)
        // TODO multi-node: unlock
        return obj;
    }

    async create(key, obj) {
        const serialized = Serializer.serialize(obj);
        await this.set(key, serialized, { NX: true });
        return obj;
    }

    async get(key) {
        return this._get(this._key(key));
    };

    // Returns
    // String on success
    // undefined on not found
    // false on storage error
    async _get(key) {
        return this.storage.get(key);
    };

    async set(key, data, opts = {}) {
        return this._set(this._key(key), data, opts);
    }

    // Returns
    // String on success
    // false on storage error
    async _set(key, data, opts) {
        return this.storage.set(key, data, opts);
    }


    async set2(arg1, arg2, arg3) {
        // set(key, obj, opts)
        if (arg1 != undefined && arg2 != undefined && arg3 != undefined) {
            return this.storage.set(this._key(arg1), arg2, arg3);
        } else if (arg1 != undefined && arg2 != undefined && arg3 == undefined) {
            // set(key, obj)
            if (typeof arg1 === 'string') {
                return this.storage.set(this._key(arg1), arg2, {});
            // set(obj, opts)
            } else {
                return this.storage.set(this._key(this.key), arg1, arg2);
            }
        // set(obj)
        } else if (arg1 != undefined && arg2 == undefined && arg3 == undefined) {
            return this.storage.set(this._key(this.key), arg1, {});
        } else {
            assert.fail("invalid call to set");
        }
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