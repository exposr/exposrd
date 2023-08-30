import { WebSocket, WebSocketServer } from "ws";
import ClusterService from "../../src/cluster/index.js";
import { StorageService } from "../../src/storage/index.js";
import { Duplex } from 'stream';
import { WebSocketMultiplex } from "@exposr/ws-multiplex";

export const initStorageService = async () => {
    return new Promise((resolve) => {
        const storage = new StorageService({
            url: new URL('memory://'),
            callback: () => { resolve(storage) }
        });
    });
};

export const initClusterService = () => {
    return new ClusterService('mem', {});
}

export const socketPair = () => {
    const sock1 = new Duplex({read(size) {}});
    const sock2 = new Duplex({read(size) {}});

    sock1._write = (chunk, encoding, callback) => {
        sock2.push(chunk);
        callback();
    };

    sock2._write = (chunk, encoding, callback) => {
        sock1.push(chunk);
        callback();
    };

    return [sock1, sock2];
};

export class wsSocketPair {
    public sock1: WebSocket;
    public sock2: WebSocket;
    public wss: WebSocketServer;

    static async create(port: number = 10000): Promise<wsSocketPair> {

        const [server, sock] = await Promise.all([
            new Promise((resolve, reject) => {
                const wss = new WebSocketServer({ port });
                wss.on('error', () => { });
                wss.on('connection', function connection(client) {
                    resolve([client, wss]);
                });

            }),
            new Promise((resolve, reject) => {
                let sock: WebSocket;
                sock = new WebSocket(`ws://127.0.0.1:${port}`);
                sock.once('error', reject);
                sock.once('open', () => {
                    sock.off('error', reject);
                    resolve(sock);
                });
            })
        ]);
        const [client, wss] = (server as Array<object>);

        const socketPair = new wsSocketPair(sock as WebSocket, client as WebSocket, wss as WebSocketServer);
        return socketPair;
    }

    private constructor(sock1: WebSocket, sock2: WebSocket, wss: WebSocketServer) {
        this.sock1 = sock1;
        this.sock2 = sock2;
        this.wss = wss;
    }

    async terminate(): Promise<void> {
        this.sock1?.terminate();
        this.sock2?.terminate();
        await new Promise((resolve) => { this.wss.close(resolve); });
    }
}

export const wsmPair = (socketPair: wsSocketPair, options?: Object): Array<WebSocketMultiplex> => {
    const wsm1 = new WebSocketMultiplex(socketPair.sock1, {
        ...options,
        reference: "wsm1"
    });
    const wsm2 = new WebSocketMultiplex(socketPair.sock2, {
        ...options,
        reference: "wsm2"
    });
    return [wsm1, wsm2];
};