import assert from 'assert/strict';
import { Logger } from '../logger.js';

class InMemoryStorage {
    constructor(callback) {
        if (InMemoryStorage.instance instanceof InMemoryStorage) {
            process.nextTick(callback);
            return InMemoryStorage.instance;
        }
        InMemoryStorage.instance = this;
        this.logger = Logger("in-memory-storage");
        this.db = {};
        this.timers = {};
        this._ttl = {};
        process.nextTick(callback);
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
            }, opts.TTL);
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

}

export default InMemoryStorage;