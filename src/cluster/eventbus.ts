import { EventEmitter } from 'events';
import { Logger } from '../logger.js';
import ClusterManager, { EmitCallback } from './cluster-manager.js';

export type EmitMeta = {
    node: {
        id: string,
        host: string,
        ip: string,
    },
    ts: number,
}

class EventBus extends EventEmitter {
    private logger: any;
    private emitCallback: EmitCallback;

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

        const emitCallback: EmitCallback = this.emitCallback = (event, message, meta) => {
            super.emit(event, message, meta);
            this.logger.isTraceEnabled() &&
               this.logger.trace({
                   operation: 'emit',
                   event,
                   message,
                   meta
               });
        };

        ClusterManager.attach(emitCallback);
    }

    public async destroy(): Promise<void> {
        this.removeAllListeners();
        ClusterManager.detach(this.emitCallback);
    }

    async publish(event: string, message: any) {
        return ClusterManager.publish(event, message);
    }

    async waitFor(channel: string, predicate: (message: any, meta: EmitMeta) => boolean, timeout: number | undefined) {
        return new Promise((resolve, reject) => {
            let timer: NodeJS.Timeout;
            const fun = (message: any, meta: EmitMeta) => {
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
