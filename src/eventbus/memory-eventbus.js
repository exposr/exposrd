import { Logger } from '../logger.js';

class MemoryEventBus {
    constructor(opts) {
        this._handler = opts.handler;
        this.logger = Logger("memory-eventbus");
        typeof opts.callback === 'function' && opts.callback();
    }

    async publish(event, message) {
        return new Promise((resolve) => {
            this._handler(event, message);
            this.logger.debug({
                operation: 'publish',
                channel: event,
                message,
            });
            resolve();
        });
    }
}

export default MemoryEventBus;