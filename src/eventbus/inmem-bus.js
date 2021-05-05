import { Logger } from '../logger.js';

class InmemBus {
    constructor(bus) {
        this._bus = bus;
        this.logger = Logger("inmem-eventbus");
    }

    publish(event, message) {
        this._bus._emit(event, message);
        this.logger.debug({
            operation: 'publish',
            channel: event,
            message,
        });

    }
}

export default InmemBus;