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
        process.nextTick(callback);
    }

    async get(key) {
        assert(key !== undefined);
        this.logger.isTraceEnabled() &&
            this.logger.trace({
                operation: 'get',
                key
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
                data: JSON.stringify(data),
            });
        if (opts.NX === true && this.db[key] !== undefined) {
            return false;
        }
        this.db[key] = data;
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