import ClusterManager from './cluster-manager.js';

export type EventBusInterfaceOptions = {
    callback: (error?: Error) => void
}

export default abstract class EventBusInterface {
    private destroyed: boolean = false;

    constructor(opts: EventBusInterfaceOptions) {
    }

    public async destroy(): Promise<void> {
        if (this.destroyed) {
            return;
        }
        await this._destroy();
        this.destroyed = true;
    }

    public async publish(message: string): Promise<void> {
        return this._publish(message);
    }

    protected abstract _publish(message: string): Promise<void>;

    protected abstract _destroy(): Promise<void>;

    protected receive(message: string): void {
        const res: Boolean | Error = ClusterManager.receive(message);
        if (res instanceof Error) {
            throw res;
        }
    }
}