import net from 'net';
import NodeSocket from "../../../src/transport/node-socket.js";

describe('node socket', () => {
    it('can be created and connected', async () => {
        const server = net.createServer();
        server.listen(10000, () => {});

        const sock = await new Promise((resolve) => {
            const sock = NodeSocket.createConnection({
                tunnelId: "tunnel",
                node: {
                    id: "node-id",
                    hostname: "node-host",
                    ip: "127.0.0.1"
                },
                port: 10000,
            }, () => {
                resolve(sock);
            });
        });

        await sock.destroy();
        await new Promise((resolve) => {
            server.close(() => {
                resolve();
            });
        });
    });
});