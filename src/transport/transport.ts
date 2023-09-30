import { EventEmitter } from 'events';
import { Duplex } from 'stream';

export type TransportConnectionOptions = {
    tunnelId?: string,
    port?: number,
};

export interface TransportOptions {
    max_connections?: number
}

export default abstract class Transport extends EventEmitter {
    public readonly max_connections: number;
    public destroyed: boolean = false;

    constructor(opts: TransportOptions) {
        super();
        this.max_connections = opts.max_connections || 1;
    }

    public abstract createConnection(opts: TransportConnectionOptions, callback: (err: Error | undefined, sock: Duplex) => void): Duplex;

    protected abstract _destroy(): Promise<void>;

    public async destroy(err?: Error): Promise<void> {
        this.destroyed = true;
        this._destroy();
        this.emit('close', err);
        this.removeAllListeners();
    }

}