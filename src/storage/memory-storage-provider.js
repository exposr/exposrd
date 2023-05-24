import assert from 'assert/strict';
import { Logger } from '../logger.js';
import StorageProvider from './storage-provider.js';
import LockService from '../lock/index.js';

class MemoryStorageProvider extends StorageProvider {
    constructor(opts) {
        super();
        this.logger = Logger("memory-storage");
        this.db = {};
        this.timers = {};
        this._ttl = {};

        new Promise((resolve, reject) => {
            const lock = new LockService("mem", {
                callback: (err) => { err ? reject(err) : resolve(lock) },
            });
        }).catch((err) => {
            typeof opts.callback === 'function' && process.nextTick(() => { opts.callback(err) });
        }).then((lock) => {
            this._lockService = lock;
            typeof opts.callback === 'function' && process.nextTick(() => { opts.callback() });
        });
    }

    async destroy() {
        await this._lockService.destroy();
        return true;
    }

    async init(ns) {
        return true;
    }

    async get(ns, key, opts) {
        const orig_key = key;
        key = this.compound_key(ns, key);

        this.logger.isTraceEnabled() &&
            this.logger.trace({
                operation: 'get',
                key,
                data: this.db[key],
            });

        let lock;
        if (opts.EX) {
            lock = await this._lockService.lock(key)
            if (!lock) {
                return [null, lock];
            }
        }

        const done = async (value) => {
            let res;
            if (value) {
                res = await this.set(ns, orig_key, value);
            }
            lock.unlock();
            return res;
        };

        const data = this.db[key] ?? null;
        return lock ? [data, done] : data;
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
        cursor = Number(cursor);
        const keys = Object.keys(this.db).filter((k) => k.startsWith(ns)).map((k) => this.key_only(ns, k));
        const data = keys.slice(cursor, cursor + count);
        return {
            cursor: data.length > 0 ? String(cursor + data.length) : null,
            data,
        }
    }

}

export default MemoryStorageProvider;