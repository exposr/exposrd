import { EventEmitter } from 'events';
import { Logger } from '../logger.js';
import Node from '../utils/node.js';
import ClusterService from './index.js';

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

        const clusterService = this.clusterService = new ClusterService();
        clusterService.attach(this);
    }

    async destroy() {
        this.removeAllListeners();
        this.clusterService.detach(this);
        return this.clusterService.destroy();
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
        return this.clusterService.publish(event, {
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
                resolve(message);
            };
            this.on(channel, fun);
            if (typeof timeout === 'number') {
                timer = setTimeout(() => {
                    this.removeListener(channel, fun);
                    reject();
                }, timeout);
            }
        });
    }
}
export default EventBus;
