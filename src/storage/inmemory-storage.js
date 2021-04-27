import assert from 'assert/strict';
import { Logger } from '../logger.js';

const _DB = {};

class InMemoryStorage {
    constructor(namespace, opts) {
        this.logger = Logger("in-memory-storage");
        this.logger.addContext("ns", namespace);
        this.ns = namespace;
        this.key = opts.key;
        if (_DB[namespace] === undefined) {
            _DB[namespace] = {};
        }
        this.db = _DB[namespace];
    }

    async get(key = undefined) {
        if (!key) {
            key = this.key;
        }
        assert(key !== undefined);
        return this.db[key];
    };

    async set(arg1, arg2, arg3) {
        // set(key, obj, opts)
        if (arg1 != undefined && arg2 != undefined && arg3 != undefined) {
            return this._set(arg1, arg2, arg3);
        } else if (arg1 != undefined && arg2 != undefined && arg3 == undefined) {
            // set(key, obj)
            if (typeof arg1 === 'string') {
                return this._set(arg1, arg2, {});
            // set(obj, opts)
            } else {
                return this._set(this.key, arg1, arg2);
            }
        // set(obj)
        } else if (arg1 != undefined && arg2 == undefined && arg3 == undefined) {
            return this._set(this.key, arg1, {});
        } else {
            assert.fail("invalid call to set");
        }
    }

    async _set(key, data, opts = {}) {
        assert(key !== undefined);
        this.logger.isTraceEnabled() && this.logger.trace(`set=${key}, opts=${JSON.stringify(opts)}, data=${JSON.stringify(data)}`);
        if (opts.NX === true && this.db[key] !== undefined) {
            return false;
        }
        this.db[key] = data;
        return this.db[key];
    };

    async delete(key = undefined) {
        if (!key) {
            key = this.key;
        }
        assert(key !== undefined);
        this.logger.isTraceEnabled() && this.logger.trace(`delete=${key}`);
        delete this.db[key];
    };

}

export default InMemoryStorage;