import assert from 'assert/strict';
import RedisLock from './redis-lock.js';
import InmemLock from './inmem-lock.js';
import { Logger } from '../logger.js';

class Lock {
    constructor(resource, lock, logger) {
        this._lock = lock;
        this.resource = resource;
        this.logger = logger;
    }

    locked() {
        return this._lock.active();
    }

    unlock() {
        return this._lock.unlock()
            .catch((err) => {
                this.logger.error({
                    message: `failed to unlock resource ${this.resource}: ${err.message}`,
                    operation: 'unlock',
                });
                return false;
            })
            .then(() => {
                this.logger.isTraceEnabled() &&
                    this.logger.trace({
                        operation: 'unlock',
                        resource: this.resource,
                    });
                return true;
            });
   }
}
export { Lock };

class LockService {
    constructor(type, opts) {
        this.logger = Logger("lock-service");

        switch (type) {
            case 'redis':
                this._lockType = new RedisLock({
                    redisUrl: opts.redisUrl,
                    callback: (err) => {
                        typeof opts.callback === 'function' && process.nextTick(() => opts.callback(err));
                    }
                });
                break;
            case 'none':
            case 'mem':
                this._lockType = new InmemLock();
                typeof opts.callback === 'function' && process.nextTick(() => opts.callback());
                break;
            default:
                assert.fail(`Unknown lock ${type}`);
        }
    }

    async destroy() {
        return this._lockType.destroy();
    }

    async lock(resource) {
        return this._lockType.lock(`lock:${resource}`)
            .catch((err) => {
                this.logger.error({
                    message: `failed to obtain lock on ${resource}: ${err.message}`,
                    operation: 'lock',
                });
                return false;
            })
            .then((lock) => {
                if (!lock) {
                    this.logger.error({
                        message: `failed to obtain lock on ${resource}`,
                        operation: 'lock',
                    });
                    return lock;
                }
                return new Lock(resource, lock, this.logger);
            })
            .finally((lock) => {
                this.logger.isTraceEnabled() &&
                    this.logger.trace({
                        operation: 'lock',
                        resource,
                        result: lock != false,
                    });
            });
    }
}

export default LockService;