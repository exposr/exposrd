import Redis from 'redis';
import Redlock from 'redlock';

class RedisLock {
    constructor(opts) {
        const redisUrl = opts.redisUrl;
        const redis = this._redisClient = Redis.createClient({
            url: redisUrl.href,
            connect_timeout: 2147483647,
        });
        this.redlock = new Redlock([redis], {
            retryCount: -1,
            retryDelay: 150,
            retryJitter:  200,
        });
    }

    async destroy() {
        return new Promise((resolve) => {
            this.redlock.quit((res) => {
                resolve();
            })
        });
    }

    async lock(resource, ttl) {
        return new Promise((resolve) => {
            this.redlock.lock(resource, ttl, (err, lock) => {
                if (err) {
                    return resolve(false);
                }
                return resolve(lock);
            });
        });
    }
}

export default RedisLock;