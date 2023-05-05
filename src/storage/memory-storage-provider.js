import assert from 'assert/strict';
import { Logger } from '../logger.js';
import StorageProvider from './storage-provider.js';

class MemoryStorageProvider extends StorageProvider {
    constructor(opts) {
        super();
        this.logger = Logger("memory-storage");
        this.db = {};
        this.timers = {};
        this._ttl = {};
        typeof opts.callback === 'function' && process.nextTick(opts.callback);
    }

    async destroy() {
        return true;
    }

    async init(ns) {
        return true;
    }

    async get(ns, key) {
        key = this.compound_key(ns, key);
        this.logger.isTraceEnabled() &&
            this.logger.trace({
                operation: 'get',
                key,
                data: this.db[key],
            });
        return this.db[key] ?? null;
    };

    async mget(ns, keys) {
        assert(keys !== undefined);
        keys = this.compound_key(ns, keys);
        this.logger.isTraceEnabled() &&
            this.logger.trace({
                operation: 'mget',
                keys,
            });
        return keys.map((k) => { return this.db[k] ?? null; });
    }

    async set(ns, key, data, opts = {}) {
        assert(key !== undefined);
        key = this.compound_key(ns, key);
        this.logger.isTraceEnabled() &&
            this.logger.trace({
                operation: 'set',
                opts,
                key,
                data
            });
        if (opts.NX === true && this.db[key] !== undefined) {
            return false;
        }
        this.db[key] = data;
        this.timers[key] && clearTimeout(this.timers[key]);
        delete this.timers[key];
        if (typeof opts.TTL == 'number') {
            this.timers[key] = setTimeout(() => {
                delete this.db[key];
            }, opts.TTL * 1000);
        }
        return this.db[key] ?? null;
    };

    async delete(ns, key) {
        assert(key !== undefined);
        key = this.compound_key(ns, key);
        this.logger.isTraceEnabled() &&
            this.logger.trace({
                operation: 'delete',
                key
            });
        if (this.db[key]) {
            delete this.db[key];
            return true;
        } else {
            return false;
        }
    };

    async list(ns, cursor, count = 10) {
        cursor ??= 0;
        const keys = Object.keys(this.db).filter((k) => k.startsWith(ns));
        const data = keys.slice(cursor, cursor + count);
        return {
            cursor: data.length > 0 ? cursor + data.length : 0,
            data,
        }
    }

}

export default MemoryStorageProvider;