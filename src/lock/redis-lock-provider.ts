import Redis, { RedisClientType } from 'redis';
import Redlock from 'redlock';
import { Logger } from '../logger.js';
import LockProvider, { ProviderLock } from './lock-provider.js';

export type RedisLockOpts = {
    redisUrl: URL;
    callback: (err?: Error) => void;
};

export default class RedisLockProvider implements LockProvider {
    private _redisClient: RedisClientType;
    private redlock!: Redlock;
    private logger: any;
    private destroyed: boolean = false;

    constructor(opts: RedisLockOpts) {
        const redisUrl = opts.redisUrl;

        const redis = this._redisClient = Redis.createClient({
            url: redisUrl.href,
            legacyMode: true,
        });

        this.logger = Logger("redis-lock");

        redis.connect()
            .catch((err) => {
                this.logger.error({
                    operation: 'redis_error',
                    message: `failed to connect to ${redisUrl}: ${err.message}`,
                    err,
                });
                typeof opts.callback === 'function' && process.nextTick(() => opts.callback(err));
            }).then(() => {
                redis.on('error', (err) => {
                    this.logger.error({
                        operation: 'redis_error',
                        message: err.message,
                        err
                    });
                });
                this.redlock = new Redlock([<any>redis], {
                    retryDelay: 200,
                    retryCount: 25,
                });

                this.redlock.on("clientError", (err: Error) => {
                    this.logger.debug({
                        operation: 'redlock',
                        message: `redis redlock error: ${err.message}`,
                        stack: err.stack,
                    });
                });

                typeof opts.callback === 'function' && process.nextTick(() => opts.callback());
            });
    }

    async destroy() {
        this.destroyed = true;
        await this._redisClient.disconnect()
            .catch((err) => {
                this.logger.error({
                    operation: 'redlock',
                    message: `failed to disconnect redlock: ${err.message}`,
                });
            });
    }

    async lock(resource: string): Promise<ProviderLock | null> {
        const leaseTime = 1000;
        try {
            const lock = await this.redlock.acquire([resource], leaseTime)
            this.logger.isTraceEnabled() &&
                this.logger.trace({
                    operation: 'redlock',
                    resource,
                    leaseTime
                });
            return new LockWrapper(this.redlock, lock, resource, leaseTime, this.logger);
        } catch (e: any) {
            this.logger.error({
                message: `failed to acquire lock on ${resource}: ${e.message}`,
                operation: 'redlock',
            });
            return null;
        }
    }
}

class LockWrapper implements ProviderLock {
    private redlock: Redlock;
    private lock: Redlock.Lock;
    private resource: string;
    private lock_active: boolean;
    private logger: any;
    private extendTimer: NodeJS.Timeout;

    constructor(redlock: Redlock, lock: Redlock.Lock, resource: string, leaseTime: number, logger: any) {
        this.logger = logger;
        this.redlock = redlock;
        this.lock = lock;
        this.resource = resource;
        this.lock_active = true;

        const extend = () => {
            this.redlock.extend(lock, leaseTime)
                .catch((err: Error) => {
                    this.lock_active = false;
                    this.logger.debug({
                        message: `failed to extend lock on ${this.resource}: ${err.message}`,
                        operation: 'redlock',
                    });
                })
                .then(() => {
                    this.logger.debug({
                        message: `lock on ${this.resource} extended`,
                        operation: 'redlock',
                    });

                    this.extendTimer = setTimeout(extend, leaseTime/2);
                });
        };

        this.extendTimer = setTimeout(extend, leaseTime/2);
    }

    public async unlock(): Promise<void> {
        this.lock_active = false;
        clearTimeout(this.extendTimer)
        return this.lock.unlock()
            .catch((err: Error) => {
                this.logger.debug({
                    message: `redlock unlock failed on resource ${this.resource}: ${err.message}`,
                    operation: 'redlock',
                });
            });
    }

    public active(): boolean {
        return this.lock_active;
    }

};