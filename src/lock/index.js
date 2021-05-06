import RedisLock from './redis-lock.js';
import InmemLock from './inmem-lock.js';
import Config from '../config.js';
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
    constructor() {
        if (LockService.instance instanceof LockService) {
            return LockService.instance;
        }
        LockService.instance = this;

        if (Config.get('redis-url') != undefined) {
            this._lock = new RedisLock();
        } else {
            this._lock = new InmemLock();
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