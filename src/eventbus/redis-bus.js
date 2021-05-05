import Redis from 'redis';
import Config from '../config.js';
import { Logger } from '../logger.js';

class RedisBus {
    constructor(bus) {
        this.logger = Logger("redis-eventbus");
        const redisUrl = Config.get('redis-url');
        this.logger.isTraceEnabled() &&
            this.logger.trace({
                operation: 'new',
                url: redisUrl,
            });
        const subscriber = Redis.createClient({
            url: redisUrl.href,
            connect_timeout: 2147483647,
        });
        this._client = subscriber.duplicate();
        subscriber.on('message', (channel, message) => {
            if (channel != 'event') {
                return;
            }
            const obj = JSON.parse(message);
            bus._emit(obj.event, obj.message);
        });
        subscriber.subscribe('event');
    }

    async publish(event, message) {
        return new Promise((resolve) => {
            this._client.publish('event', JSON.stringify({event, message}), (err, num) => {
                this.logger.debug({
                    operation: 'publish',
                    event,
                    num,
                    err,
                    message,
                });
                if (err) {
                    resolve(false);
                }
                resolve(true);
            });
        });
    }
}

export default RedisBus;