import assert from 'assert/strict';
import { Logger } from '../logger.js';

class MemoryStorageProvider {
    constructor(opts) {
        this.logger = Logger("memory-storage");
        this.db = {};
        this.timers = {};
        this._ttl = {};
        typeof opts.callback === 'function' && process.nextTick(opts.callback);
    }

    async destroy() {
        return true;
    }

    async get(key) {
        assert(key !== undefined);
        this.logger.isTraceEnabled() &&
            this.logger.trace({
                operation: 'get',
                key,
                data: this.db[key],
            });
        return this.db[key];
    };

    async mget(keys) {
        assert(keys !== undefined);
        this.logger.isTraceEnabled() &&
            this.logger.trace({
                operation: 'mget',
                keys,
            });
        return keys.map((k) => { return this.db[k]; });
    }

    async set(key, data, opts = {}) {
        assert(key !== undefined);
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
        return this.db[key];
    };

    async delete(key) {
        assert(key !== undefined);
        this.logger.isTraceEnabled() &&
            this.logger.trace({
                operation: 'delete',
                key
            });
        delete this.db[key];
    };

    async list(ns, cursor, count = 10) {
        const keys = Object.keys(this.db).filter((k) => k.startsWith(ns));
        const data = keys.slice(cursor, cursor + count);
        return {
            cursor: data.length > 0 ? cursor + data.length : 0,
            data,
        }
    }

}

export default MemoryStorageProvider;