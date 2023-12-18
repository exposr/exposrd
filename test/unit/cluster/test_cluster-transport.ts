import assert from 'assert/strict';
import net from 'net';
import tls from 'tls';
import fs from 'fs';
import sinon from 'sinon';
import ClusterTransport from '../../../src/transport/cluster/cluster-transport.js';
import { Duplex } from 'stream';
import Config from '../../../src/config.js';
import ClusterManager, { ClusterManagerType, ClusterNode } from '../../../src/cluster/cluster-manager.js';

describe('cluster transport', () => {
    it('can be created and connected', async () => {
        const config = new Config();
        const server = net.createServer((socket: net.Socket) => {
            socket.end('success');
        });

        await new Promise((resolve) => {
            server.listen(10000, () => { resolve(undefined); });
        });

        await ClusterManager.init(ClusterManagerType.MEM);

        sinon.stub(ClusterManager, "getNode").returns(<ClusterNode>{
            id: "some-node-id",
            host: "some-node-host",
            ip: "127.0.0.1",
            last_ts: new Date().getTime(),
            stale: false,
        });

        const clusterTransport = new ClusterTransport({
            nodeId: 'some-node-id'
        });

        const sock: Duplex = await new Promise((resolve) => {
            const sock = clusterTransport.createConnection({
                port: 10000,
                remoteAddr: "127.0.0.2"
            }, () => {
                resolve(sock);
            });
        });

        const data = await new Promise((resolve) => {
            sock.once('data', (chunk: Buffer) => {
                resolve(chunk.toString());
            });
        });

        await ClusterManager.close();
        sock.destroy();
        await new Promise((resolve) => {
            server.close(() => {
                resolve(undefined);
            });
        });
        config.destroy();
        sinon.restore();

        assert(data == 'success');
    });

    it('can connect to tls', async () => {
        const config = new Config();

        const key = fs.readFileSync(new URL('../fixtures/cn-private-key.pem', import.meta.url).pathname);
        const cert = fs.readFileSync(new URL('../fixtures/cn-public-cert.pem', import.meta.url).pathname);

        const server = tls.createServer({
            key,
            cert,
        }, (socket: tls.TLSSocket) => {
            const servername = (<any>socket).servername;
            socket.end(servername);
        });

        await new Promise((resolve) => {
            server.listen(11000, () => { resolve(undefined); });
        });

        await ClusterManager.init(ClusterManagerType.MEM);

        sinon.stub(ClusterManager, "getNode").returns(<ClusterNode>{
            id: "some-node-id",
            host: "some-node-host",
            ip: "127.0.0.1",
            last_ts: new Date().getTime(),
            stale: false,
        });

        const clusterTransport = new ClusterTransport({
            nodeId: 'some-node-id'
        });

        const sock: Duplex = await new Promise((resolve) => {
            const sock = clusterTransport.createConnection({
                port: 11000,
                remoteAddr: "127.0.0.2",
                tls: {
                    enabled: true,
                    servername: 'test.example.com',
                    cert: cert,
                }
            }, () => {
                resolve(sock);
            });
        });

        const data = await new Promise((resolve) => {
            sock.once('data', (chunk: Buffer) => {
                resolve(chunk.toString());
            });
        });

        await ClusterManager.close();
        sock.destroy();
        await new Promise((resolve) => {
            server.close(() => {
                resolve(undefined);
            });
        });
        config.destroy();
        sinon.restore();

        assert(data == 'test.example.com');
    });
});