import assert from 'assert/strict';
import RedisLockProvider from './redis-lock-provider.js';
import MemoryLockProvider from './memory-lock-provider.js';
import { Logger } from '../logger.js';
import LockProvider, { ProviderLock } from './lock-provider.js';

class Lock {
    private _lock: ProviderLock;
    private resource: string;
    private logger: any;

    constructor(resource: string, lock: ProviderLock, logger: any) {
        this._lock = lock;
        this.resource = resource;
        this.logger = logger;
    }

    public locked(): boolean {
        return this._lock.active();
    }

    public async unlock(): Promise<boolean> {
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

export type LockType = "redis" | "mem" | "none";
export type LockServiceOpts = {
    callback: (err?: Error) => void;
    redisUrl?: URL;
};

class LockService {
    private logger: any;
    private lockProvider!: LockProvider;

    constructor(type: LockType, opts: LockServiceOpts) {
        this.logger = Logger("lock-service");

        switch (type) {
            case 'redis':
                this.lockProvider = new RedisLockProvider({
                    redisUrl: <URL>opts.redisUrl,
                    callback: (err) => {
                        typeof opts.callback === 'function' && process.nextTick(() => opts.callback(err));
                    }
                });
                break;
            case 'none':
            case 'mem':
                this.lockProvider = new MemoryLockProvider();
                typeof opts.callback === 'function' && process.nextTick(() => opts.callback());
                break;
            default:
                assert.fail(`Unknown lock ${type}`);
        }
    }

    async destroy(): Promise<void> {
        await this.lockProvider.destroy();
    }

    async lock(resource: string): Promise<Lock | false> {
        try {
            const lock = await this.lockProvider.lock(`lock:${resource}`);
            if (lock == null) {
                throw new Error(`lock provider returned null lock`);
            }

            this.logger.isTraceEnabled() &&
                this.logger.trace({
                    operation: 'lock',
                    resource,
                    result: lock != null,
                });
            return new Lock(resource, lock, this.logger);
        } catch (e: any) {
            this.logger.error({
                message: `failed to obtain lock on ${resource}: ${e.message}`,
                operation: 'lock',
            });
            return false;
        }
    }
}

export default LockService;