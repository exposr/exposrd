import Redis from 'redis';
import Redlock from 'redlock';
import Config from '../config.js';

class RedisLock {
    constructor() {
        const redisUrl = Config.get('redis-url');
        const redis = Redis.createClient({
            url: redisUrl.href,
            connect_timeout: 2147483647,
        });
        this.redlock = new Redlock([redis], {
            retryCount: -1,
            retryDelay: 150,
            retryJitter:  200,
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