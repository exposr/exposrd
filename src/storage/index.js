import InMemoryStorage from './inmemory-storage.js';
import RedisStorage from './redis-storage.js';
import Config from '../config.js'
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
        this.key = opts.key;
    }

    _key(key) {
        return `${this.ns}:${key}`;
    }

    // Returns
    // Object on success
    // undefined on not found
    // false on storage error
    async get(key = undefined) {
        if (!key) {
            key = this.key;
        }
        assert(key !== undefined);
        return this.storage.get(this._key(key));
    };

    // Returns
    // Object on success
    // false on storage error
    async set(arg1, arg2, arg3) {
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