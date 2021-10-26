import assert from 'assert/strict';
import { EventEmitter } from 'events';
import { Logger } from '../logger.js';
import Node from '../utils/node.js';
import MemoryEventBus from './memory-eventbus.js';
import RedisEventBus from './redis-eventbus.js';

class EventBusService {
    constructor(type, opts) {
        if (EventBusService.instance instanceof EventBusService) {
            EventBusService.ref++;
            return EventBusService.instance;
        }
        assert(type != null, "type not given");
        EventBusService.instance = this;
        EventBusService.ref = 1;

        this._listeners = [];
        const onMessage = (event, message) => {
            this.emit(event, message);
        };

        const ready = (err) => {
            typeof opts.callback === 'function' && opts.callback(err);
        };

        switch (type) {
            case 'redis':
                this._bus = new RedisEventBus({
                    ...opts,
                    callback: ready,
                    handler: onMessage,
                })
                break;
            case 'mem':
                this._bus = new MemoryEventBus({
                    ...opts,
                    callback: ready,
                    handler: onMessage,
                });
                break;
            default:
                assert.fail(`unknown type ${type}`);
        }
    }

    attach(bus) {
        this._listeners.push(bus);
    }

    detach(bus) {
        this._listeners = this._listeners.filter((x) => x != bus);
    }

    emit(event, message) {
        this._listeners.forEach((l) => l._emit(event, message));
    }

    async publish(event, message) {
        return this._bus.publish(event, message);
    }

    async destroy() {
        if (--EventBusService.ref == 0) {
            return this._bus.destroy();
        }
    }
}

export { EventBusService };

class EventBus extends EventEmitter {
    constructor() {
        super();
        this.logger = Logger("eventbus");

        this.setMaxListeners(1);
        this.on('newListener', () => {
            this.setMaxListeners(this.getMaxListeners() + 1);
        });
        this.on('removeListener', () => {
            this.setMaxListeners(this.getMaxListeners() - 1);
        });

        const eventBusService = this.eventBusService = new EventBusService();
        eventBusService.attach(this);
    }

    async destroy() {
        this.removeAllListeners();
        this.eventBusService.detach(this);
        return this.eventBusService.destroy();
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

    async publish(event, message) {
        return this.eventBusService.publish(event, {
            ...message,
            _node: {
                id: Node.identifier,
                host: Node.hostname,
            },
            _ts: new Date().getTime(),
        });
    }

    async waitFor(channel, predicate, timeout = undefined) {
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