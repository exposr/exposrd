import RedisLock from './redis-lock.js';
import InmemLock from './inmem-lock.js';
import { Logger } from '../logger.js';

const logger = Logger("lock-service");

class Lock {
    constructor(resource, lock) {
        this._lock = lock;
        this.resource = resource;
    }

    unlock() {
        this._lock.unlock();
        logger.isTraceEnabled() &&
            logger.trace({
                operation: 'unlock',
                resource: this.resource,
            });
    }
}

class LockService {
    constructor(type, opts) {
        if (LockService.instance instanceof LockService) {
            LockService.ref++;
            return LockService.instance;
        }
        LockService.ref = 1;
        LockService.instance = this;

        switch (type) {
            case 'redis':
                this._lock = new RedisLock({
                    redisUrl: opts.redisUrl
                });
                break;
            case 'mem':
                this._lock = new InmemLock();
                break;
            default:
                assert.fail(`Unknown lock ${type}`);
        }
    }

    async destroy() {
        if (--LockService.ref == 0) {
            delete LockService.instance;
            return this._lock.destroy();
        }
    }

    async lock(resource, ttl = 5000) {
        const lock = await this._lock.lock(`lock:${resource}`, ttl);
        logger.isTraceEnabled() &&
            logger.trace({
                operation: 'lock',
                resource,
                result: !!lock,
            });
        if (!lock) {
            return lock;
        }
        return new Lock(resource, lock);
    }
}

export default LockService;