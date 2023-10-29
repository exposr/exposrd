import * as http from 'node:http';
import https from 'node:https'
import fs from 'node:fs';
import { Duplex } from 'node:stream';
import * as url from 'node:url';
import { WebSocket, WebSocketServer } from "ws";
import ClusterService from "../../src/cluster/index.js";
import { StorageService } from "../../src/storage/index.js";
import { WebSocketMultiplex } from "@exposr/ws-multiplex";

export const initStorageService = async (): Promise<StorageService> => {
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

export const createEchoHttpServer = async (port: number = 20000, crtPath?: string | undefined, keyPath?: string | undefined) => {

    const echoRequest = (request: http.IncomingMessage, response: http.ServerResponse) => {
        let body: Array<Buffer> = [];
        request.on('data', (chunk: Buffer) => {
            body.push(chunk);
        }).on('end', () => {
            const buf = Buffer.concat(body).toString();
            response.statusCode = 200;
            response.end(buf);
        });
    };

    const fileGenerator = (size: number, chunkSize: number, response: http.ServerResponse) => {
        let sentBytes: number = 0;

        response.statusCode = 200;
        response.setHeader("Content-Type", "application/octet-stream");
        response.setHeader('Content-Disposition', 'attachment; filename="file.bin"');
        response.setHeader("Content-Length", size);

        const writeChunk = () => {
            if (sentBytes < size) {
                const remainingBytes = size - sentBytes;
                const chunkToSend = Math.min(chunkSize, remainingBytes);

                const buffer = Buffer.alloc(chunkToSend);
                response.write(buffer);

                sentBytes += chunkToSend;

                setTimeout(writeChunk, 0);
            } else {
                response.end();
            }
        }

        writeChunk();
    };

    const wss = new WebSocketServer({ noServer: true });
    const handleUpgrade = (async (request: http.IncomingMessage, socket: Duplex, head: Buffer) => {
        const parsedUrl = url.parse(<string>request.url, true)
        if (parsedUrl.pathname != '/ws') {
            socket.write(`HTTP/${request.httpVersion} 404 Not found\r\n`);
            socket.end();
            socket.destroy();
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
            ws.send("ws echo connected");
            ws.on('message', (data) => {
                ws.send(data);
            });
        });
    });

    const handleRequest = (request: http.IncomingMessage, response: http.ServerResponse) => {

        const parsedUrl = url.parse(<string>request.url, true)

        if (request.method == "GET" && parsedUrl.pathname == '/file') {
            const size = Number(parsedUrl.query["size"] || "32");
            const chunkSize = Number(parsedUrl.query["chunk"] || "262144");
            return fileGenerator(size, chunkSize, response);
        } else {
            return echoRequest(request, response);
        }
    }

    let server: http.Server | https.Server;
    if (crtPath && keyPath) {
        const cert = fs.readFileSync(crtPath); 
        const key = fs.readFileSync(keyPath);
        server = https.createServer({cert, key});
    } else {
        server = http.createServer();
    }

    server.on('request', handleRequest);
    server.on('upgrade', handleUpgrade);

    await new Promise((resolve) => {
        server.listen(port, () => {
            resolve(undefined);
        });
    });
    return {
        destroy: async () => {
            await new Promise((resolve) => {
                server.close(resolve);
                server.closeAllConnections();
                server.removeAllListeners('request');
                server.removeAllListeners('upgrade');
            });
        }
    };
};