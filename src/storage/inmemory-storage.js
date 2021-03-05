import { Logger } from '../logger.js';

const _DB = {};

class InMemoryStorage {
    constructor(namespace, opts) {
        this.logger = Logger("in-memory-storage");
        this.logger.addContext("ns", namespace);
        this.ns = namespace;
        if (_DB[namespace] === undefined) {
            _DB[namespace] = {};
        }
        this.db = _DB[namespace];
    }

    async get(key) {
        return this.db[key];
    };

    async set(key, data, opts = {}) {
        this.logger.isTraceEnabled() && this.logger.trace(`set=${key}, opts=${JSON.stringify(opts)}, data=${JSON.stringify(data)}`);
        if (opts.NX === true && this.db[key] !== undefined) {
            return false;
        }
        this.db[key] = data;
        return this.db[key];
    };

    async delete(key) {
        this.logger.isTraceEnabled() && this.logger.trace(`delete=${key}`);
        delete this.db[key];
    };

}

export default InMemoryStorage;