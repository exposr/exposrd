import * as http from 'node:http';
import { Duplex } from 'node:stream';
import * as url from 'node:url';
import { WebSocketServer } from 'ws';

export const createEchoHttpServer = async (port = 20000) => {

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
            ws.send("hello");
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

    const server = http.createServer();
    server.on('request', handleRequest);
    server.on('upgrade', handleUpgrade);

    server.listen(port);
    return {
        destroy: () => {
            server.removeAllListeners('request');
            server.removeAllListeners('upgrade');
            server.close();
        }
    };
};

const echoServer = createEchoHttpServer();