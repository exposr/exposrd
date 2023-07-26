import { WebSocket, WebSocketServer } from "ws";
import ClusterService from "../../src/cluster/index.js";
import { StorageService } from "../../src/storage/index.js";
import { Duplex } from 'stream';

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

export const wsSocketPair = async (port = 10000) => {
    const wss = new WebSocketServer({ port });

    return new Promise((resolve, reject) => {
        let sock1;
        wss.on('connection', function connection(sock2) {
            resolve([sock1, sock2, wss]);
        });
        sock1 = new WebSocket(`ws://127.0.0.1:${port}`);
        sock1.on('error', reject);
    });
};