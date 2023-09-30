import WebSocket from 'ws';
import Transport, { TransportOptions } from '../transport.js';
import { WebSocketMultiplex } from '@exposr/ws-multiplex';
import { Duplex } from 'stream';

export type WebSocketTransportOptions = TransportOptions & {
    tunnelId: string,
    socket: WebSocket,
};

export default class WebSocketTransport extends Transport {
    private wsm: WebSocketMultiplex;

    constructor(options: WebSocketTransportOptions) {
        super({
            max_connections: options.max_connections
        });

        this.wsm = new WebSocketMultiplex(options.socket, {
            reference: options.tunnelId
        });

        this.wsm.once('error', (err: Error) => {
            this.destroy(err);
        });

        this.wsm.once('close', () => {
            this.destroy();
        });
    }

    public createConnection(opts: any = {}, callback: (err: Error | undefined, sock: Duplex) => void): Duplex {
        return this.wsm.createConnection({}, callback);
    }

    protected async _destroy(): Promise<void> {
        this.wsm.removeAllListeners();
        await this.wsm.destroy();
    }
}