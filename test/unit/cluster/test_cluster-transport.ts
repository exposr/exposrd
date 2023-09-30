import net from 'net';
import sinon from 'sinon';
import ClusterTransport from '../../../src/transport/cluster/cluster-transport.js';
import ClusterService, { ClusterNode } from '../../../src/cluster/index.js';
import { Duplex } from 'stream';
import Config from '../../../src/config.js';

describe('cluster transport', () => {
    it('can be created and connected', async () => {
        const config = new Config();
        const server = net.createServer();
        server.listen(10000, () => {});

        const clusterService = new ClusterService("mem");

        sinon.stub(ClusterService.prototype, "getNode").returns(<ClusterNode>{
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
                remoteAddr: "127.0.0.1"
            }, () => {
                resolve(sock);
            });
        });

        await clusterService.destroy();
        sock.destroy();
        await new Promise((resolve) => {
            server.close(() => {
                resolve(undefined);
            });
        });
        config.destroy();
    });
});