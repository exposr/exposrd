import { EventEmitter } from 'events';
import Config from '../config.js';
import { Logger } from '../logger.js';
import Node from '../utils/node.js';
import InmemBus from './inmem-bus.js';
import RedisBus from './redis-bus.js';

class EventBus extends EventEmitter {
    constructor() {
        if (EventBus.instance instanceof EventBus) {
            return EventBus.instance;
        }
        super();
        EventBus.instance = this;
        this.logger = Logger("eventbus");

        if (Config.get('redis-url') != undefined) {
            this.bus = new RedisBus(this);
        } else {
            this.bus = new InmemBus(this);
        }

        this.setMaxListeners(1);
        this.on('newListener', () => {
            this.setMaxListeners(this.getMaxListeners() + 1);
        });
        this.on('removeListener', () => {
            this.setMaxListeners(this.getMaxListeners() - 1);
        });
    }

    _emit(event, message) {
        super.emit(event, message);
        this.logger.isTraceEnabled() &&
            this.logger.trace({
                operation: 'emit',
                event,
                message
            });
    }

    publish(event, message) {
        this.bus.publish(event, {
            ...message,
            _node: {
                id: Node.identifier,
                host: Node.hostname,
            },
            _ts: new Date().getTime(),
        });
    }

    waitFor(channel, predicate, timeout = undefined) {
        return new Promise((resolve, reject) => {
            let timer;
            const fun = (message) => {
                if (!predicate(message)) {
                    return;
                }
                this.removeListener(channel, fun);
                timer && clearTimeout(timer);
                resolve();
            };
            this.on(channel, fun)
            if (typeof timeout === 'number') {
                timer = setTimeout(reject, timeout)
            }
        });
    }
}

export default EventBus;