import WebSocket from 'ws';
import Transport from '../transport.js';
import { WebSocketMultiplex } from '@exposr/ws-multiplex';
import { Duplex } from 'stream';

export type WebSocketTransportOptions = {
    tunnelId: string,
    max_connections: number,
    socket: WebSocket,
};

export default class WebSocketTransport extends Transport {
    private wsm: WebSocketMultiplex;
    private destroyed: boolean = false;

    constructor(options: WebSocketTransportOptions) {
        super({
            max_connections: options.max_connections
        });

        this.wsm = new WebSocketMultiplex(options.socket, {
            reference: options.tunnelId
        });

        this.wsm.on('error', (err: Error) => {
            this._destroy(err);
        });
    }

    public createConnection(opts: object = {}, callback: (err: Error | undefined, sock: Duplex) => void): any {
        return this.wsm.createConnection({}, callback);
    }

    public async destroy(): Promise<void> {
        return this._destroy();
    }

    private async _destroy(err?: Error): Promise<void> {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        await this.wsm.destroy();
        this.emit('close', err);
    }
}