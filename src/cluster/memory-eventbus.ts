import { Logger } from '../logger.js';
import EventBusInterface, { EventBusInterfaceOptions } from './eventbus-interface.js';

export type MemoryEventBusOptions = EventBusInterfaceOptions;

class MemoryEventBus extends EventBusInterface {
    private logger: any;

    constructor(opts: EventBusInterfaceOptions) {
        super(opts)
        this.logger = Logger("memory-eventbus");
        typeof opts.callback === 'function' && process.nextTick(opts.callback);
    }

    protected async _destroy(): Promise<void> {
    }

    protected async _publish(message: string): Promise<void> {
        return new Promise((resolve) => {
            process.nextTick(() => {
                try {
                    this.receive(message);
                    this.logger.debug({
                        operation: 'publish',
                        message,
                    });
                } catch (e: any) {
                    this.logger.error({
                        message: `failed to receive message ${message}: ${e.message}`,
                    });
                }
                resolve();
            });
        });
    }
}

export default MemoryEventBus;