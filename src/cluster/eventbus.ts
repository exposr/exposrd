import { EventEmitter } from 'events';
import { Logger } from '../logger.js';
import ClusterService from './index.js';

type EmitMeta = {
    node: {
        id: string,
        host: string,
        ip: string,
    },
    ts: number,
}

class EventBus extends EventEmitter {
    private logger: any;
    private clusterService: ClusterService;

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

    public async destroy() {
        this.removeAllListeners();
        this.clusterService.detach(this);
        return this.clusterService.destroy();
    }

    public _emit(event: string, message: string, meta: EmitMeta) {
        super.emit(event, message, meta);
        this.logger.isTraceEnabled() &&
           this.logger.trace({
               operation: 'emit',
               event,
               message,
               meta
           });
    }

    async publish(event: string, message: object) {
        return this.clusterService.publish(event, message);
    }

    async waitFor(channel: string, predicate: (message: string, meta: EmitMeta) => boolean, timeout: number | undefined) {
        return new Promise((resolve, reject) => {
            let timer: NodeJS.Timeout;
            const fun = (message: string, meta: EmitMeta) => {
                if (!predicate(message, meta)) {
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
