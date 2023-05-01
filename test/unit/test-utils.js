import ClusterService from "../../src/cluster/index.js";
import { StorageService } from "../../src/storage/index.js";
import { Duplex } from 'stream';

export const initStorageService = async () => {
    return new Promise((resolve) => {
        const storage = new StorageService('mem', {
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