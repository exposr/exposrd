import { Logger } from '../logger.js';

class MemoryEventBus {
    constructor(opts) {
        this._handler = opts.handler;
        this.logger = Logger("memory-eventbus");
        typeof opts.callback === 'function' && process.nextTick(opts.callback);
    }

    async destroy() {
        return true;
    }

    async publish(message) {
        return new Promise((resolve) => {
            process.nextTick(() => {
                this._handler(message);
                this.logger.debug({
                    operation: 'publish',
                    channel: message.event,
                    message,
                });
                resolve();
            });
        });
    }
}

export default MemoryEventBus;