import assert from 'assert/strict';
import crypto from 'crypto';
import sinon from 'sinon';
import net from 'net';
import Config from '../../../src/config.js';
import { wsSocketPair } from '../test-utils.js';
import AccountService from '../../../src/account/account-service.js';
import TunnelConnectionManager from '../../../src/tunnel/tunnel-connection-manager.js';
import IngressManager from '../../../src/ingress/ingress-manager.js';
import TunnelService from '../../../src/tunnel/tunnel-service.js';
import Tunnel from '../../../src/tunnel/tunnel.js';
import EventBus from '../../../src/cluster/eventbus.js';
import WebSocketTransport from '../../../src/transport/ws/ws-transport.js';
import { WebSocketMultiplex } from '@exposr/ws-multiplex';
import ClusterManager, { ClusterManagerType } from '../../../src/cluster/cluster-manager.js';
import StorageManager from '../../../src/storage/storage-manager.js';
import Account from '../../../src/account/account.js';

describe('tunnel service', () => {
    let clock: sinon.SinonFakeTimers;
    let config: Config;
    let accountService: AccountService;

    beforeEach(async () => {
        clock = sinon.useFakeTimers({shouldAdvanceTime: true, now: 10000});
        config = new Config();
        await StorageManager.init(new URL("memory://"));
        await ClusterManager.init(ClusterManagerType.MEM);
        await TunnelConnectionManager.start();
        await IngressManager.listen({
            http: {
                enabled: true,
                subdomainUrl: new URL("https://example.com"),
                port: 8080,
            }
        });
        accountService = new AccountService();
    });

    afterEach(async () => {
        await accountService.destroy();
        await IngressManager.close();
        await TunnelConnectionManager.stop();
        await ClusterManager.close();
        await StorageManager.close();
        await config.destroy();
        clock.restore();
        sinon.restore();
    })

    it(`can create new tunnel`, async () => {
        const tunnelService = new TunnelService();

        const account = await accountService.create();
        assert(account instanceof Account, "did not create account");
        assert(account.id != undefined, "account id is undefined");
        const tunnelId = crypto.randomBytes(20).toString('hex');

        const tunnel = await tunnelService.create(tunnelId, account.id);

        assert(tunnel instanceof Tunnel, `tunnel not created, got ${tunnel}`);
        assert(tunnel?.id == tunnelId, `expected id ${tunnelId}, got ${tunnel?.id}`);

        const tunnel2 = await tunnelService.get(tunnelId, account.id);
        assert(tunnel2.id == tunnelId);

        await tunnelService.destroy();
    });

    it(`can create, update and delete tunnel`, async () => {
        const tunnelService = new TunnelService();

        let account = await accountService.create();
        assert(account instanceof Account, "did not create account");
        assert(account.id != undefined, "account id is undefined");
        const tunnelId = crypto.randomBytes(20).toString('hex');

        let tunnel = await tunnelService.create(tunnelId, account.id);

        assert(tunnel instanceof Tunnel, `tunnel not created, got ${tunnel}`);
        assert(tunnel?.id == tunnelId, `expected id ${tunnelId}, got ${tunnel?.id}`);

        account = await accountService.get(account.id);
        assert(account instanceof Account, "did not create account");
        assert(account.id != undefined, "account id is undefined");
        assert(account.tunnels.indexOf(tunnelId) != -1, "account does not own created tunnel");

        await tunnelService.update(tunnelId, account.id, (tunnelConfig) => {
            tunnelConfig.target.url = "http://example.com"
        });

        tunnel = await tunnelService.lookup(tunnelId);
        assert(tunnel.config.target.url == 'http://example.com', 'tunnel config not updated');

        let res = await tunnelService.delete(tunnelId, account.id);
        assert(res == true, `tunnel not deleted, got ${res}`);

        try {
            tunnel = await tunnelService.get(tunnelId, account.id);
        } catch (e: any) {
            assert(e.message == 'no_such_tunnel', `tunnel not deleted, got ${e.message}`);
        }

        account = await accountService.get(account.id);
        assert(account != undefined);
        assert(account.tunnels.indexOf(tunnelId) == -1, "tunnel listed on account after deletion");

        await tunnelService.destroy();
    });

    it(`can list tunnels`, async () => {
        const tunnelService = new TunnelService();
        let account = await accountService.create();
        assert(account instanceof Account, "did not create account");
        assert(account.id != undefined, "account id is undefined");

        for (let i = 0; i < 100; i++) {
            const tunnelId = crypto.randomBytes(20).toString('hex');
            await tunnelService.create(tunnelId, account.id);
        }

        const expectedTunnels = 100;

        let cursor: any;
        let tunnels: number = 0;
        do {
            const result = await tunnelService.list(cursor, 10, false);
            tunnels += result.tunnels.length;
            cursor = result.cursor;
        } while (cursor != null);

        assert(tunnels == expectedTunnels, "wrong number of tunnels");

        tunnels = 0;
        do {
            const result = await tunnelService.list(cursor, 10, true);
            tunnels += result.tunnels.length;
            cursor = result.cursor;
        } while (cursor != null);

        assert(tunnels == expectedTunnels, "wrong number of tunnels");

        await tunnelService.destroy();
    });

    it(`can connect and disconnect tunnel`, async () => {
        const tunnelService = new TunnelService();
        const bus = new EventBus();

        const account = await accountService.create();
        assert(account instanceof Account, "did not create account");
        assert(account.id != undefined, "account id is undefined");
        const tunnelId = crypto.randomBytes(20).toString('hex');

        let tunnel = await tunnelService.create(tunnelId, account.id);
        assert(tunnel instanceof Tunnel, `tunnel not created, got ${tunnel}`);
        assert(tunnel?.id == tunnelId, `expected id ${tunnelId}, got ${tunnel?.id}`);

        const sockPair = await wsSocketPair.create();
        const transport = new WebSocketTransport({
            tunnelId: tunnelId,
            socket: sockPair.sock1,
        })

        const msgPromise = new Promise((resolve) => {
            bus.once('tunnel:announce', (msg) => {
                setImmediate(() => { resolve(msg) });
            })
        });

        let res = await tunnelService.connect(tunnelId, account.id, transport, {peer: "127.0.0.1"});
        assert(res == true, `connect did not return true, got ${res}`);

        const msg: any = await msgPromise;
        assert(msg.tunnel != tunnelId, "did not get tunnel announcement");

        tunnel = await tunnelService.lookup(tunnelId);
        assert(tunnel.state.connected == true, "tunnel state is not connected");

        const localCon = TunnelConnectionManager.isLocalConnected(tunnelId);
        assert(localCon == true, "isLocalConnected returned false");

        res = await tunnelService.disconnect(tunnelId, account.id);
        assert(res == true, "failed to disconnect tunnel");

        tunnel = await tunnelService.lookup(tunnelId);
        assert(tunnel.state.connected == false, "tunnel state is connected");

        assert(tunnel.state.connections[0].connected == false, "tunnel connection is disconnected");

        await tunnelService.destroy();
        await bus.destroy();
        await transport.destroy();
        await sockPair.terminate();
    });

    it(`can have multiple connections`, async () => {
        const tunnelService = new TunnelService();
        const bus = new EventBus();

        const account = await accountService.create();
        assert(account instanceof Account, "did not create account");
        assert(account.id != undefined, "account id is undefined");
        const tunnelId = crypto.randomBytes(20).toString('hex');

        let tunnel = await tunnelService.create(tunnelId, account.id);
        assert(tunnel instanceof Tunnel, `tunnel not created, got ${tunnel}`);
        assert(tunnel?.id == tunnelId, `expected id ${tunnelId}, got ${tunnel?.id}`);

        const sockPair1 = await wsSocketPair.create(10000);
        const transport1 = new WebSocketTransport({
            tunnelId: tunnelId,
            socket: sockPair1.sock1,
            max_connections: 2,
        });

        let res = await tunnelService.connect(tunnelId, account.id, transport1, {peer: "127.0.0.1"});
        assert(res == true, `connect did not return true, got ${res}`);

        const sockPair2 = await wsSocketPair.create(10001);
        const transport2 = new WebSocketTransport({
            tunnelId: tunnelId,
            socket: sockPair2.sock1,
            max_connections: 2,
        });

        res = await tunnelService.connect(tunnelId, account.id, transport2, {peer: "127.0.0.1"});
        assert(res == true, `connect did not return true, got ${res}`);

        tunnel = await tunnelService.lookup(tunnelId);
        assert(tunnel.state.connected == true, "tunnel state is not connected");
        assert(tunnel.state.alive_connections == 2);
        assert(tunnel.state.connections.length == 2)
        assert(tunnel.state.connections[0].connected == true);
        assert(tunnel.state.connections[1].connected == true);

        let tunnelConnection1 = TunnelConnectionManager["getNextConnection"](tunnelId);
        let tunnelConnection2 = TunnelConnectionManager["getNextConnection"](tunnelId);
        assert(tunnelConnection1?.connection_id != tunnelConnection2?.connection_id, "getNextConnection repeated connection");

        let tunnelConnection3 = TunnelConnectionManager["getNextConnection"](tunnelId);
        assert(tunnelConnection1?.connection_id == tunnelConnection3?.connection_id, "getNextConnection did not wrap around");
        let tunnelConnection4 = TunnelConnectionManager["getNextConnection"](tunnelId);
        assert(tunnelConnection2?.connection_id == tunnelConnection4?.connection_id, "getNextConnection did not wrap around");

        res = await tunnelService.disconnect(tunnelId, account.id);
        assert(res == true, "failed to disconnect tunnel");

        tunnel = await tunnelService.lookup(tunnelId);
        assert(tunnel.state.connected == false, "tunnel state is connected");
        assert(tunnel.state.connections[0].connected == false, "tunnel connection is disconnected");
        assert(tunnel.state.connections[1].connected == false, "tunnel connection is disconnected");

        await tunnelService.destroy();
        await bus.destroy();
        await transport1.destroy();
        await sockPair1.terminate();
        await transport2.destroy();
        await sockPair2.terminate();
    });

    it(`is disconnected when transport is destroyed`, async () => {
        const tunnelService = new TunnelService();
        const bus = new EventBus();

        const account = await accountService.create();
        assert(account instanceof Account, "did not create account");
        assert(account.id != undefined, "account id is undefined");
        const tunnelId = crypto.randomBytes(20).toString('hex');

        let tunnel = await tunnelService.create(tunnelId, account.id);
        assert(tunnel instanceof Tunnel, `tunnel not created, got ${tunnel}`);
        assert(tunnel?.id == tunnelId, `expected id ${tunnelId}, got ${tunnel?.id}`);

        const sockPair = await wsSocketPair.create();
        const transport = new WebSocketTransport({
            tunnelId: tunnelId,
            socket: sockPair.sock1,
        })

        let res = await tunnelService.connect(tunnelId, account.id, transport, {peer: "127.0.0.1"});
        assert(res == true, `connect did not return true, got ${res}`);

        tunnel = await tunnelService.lookup(tunnelId);
        assert(tunnel.state.connected == true, "tunnel state is not connected");

        const msg = new Promise((resolve) => {
            bus.once('tunnel:announce', (msg) => {
                setImmediate(() => { resolve(msg) });
            })
        });

        // Close remote socket to trigger a destroy of the transport
        sockPair.sock2.close();
        await msg;

        tunnel = await tunnelService.lookup(tunnelId);
        assert(tunnel.state.connected == false, "tunnel state is connected");
        assert(tunnel.state.connections[0].connected == false, "tunnel connection is disconnected");
        assert(tunnel.state.alive_connections == 0, "alive connections is not zero");

        await tunnelService.destroy();
        await bus.destroy();
        await transport.destroy();
        await sockPair.terminate();
    });

    it(`can authorize a tunnel`, async () => {
        const tunnelService = new TunnelService();
        const account = await accountService.create();
        assert(account instanceof Account, "did not create account");
        assert(account.id != undefined, "account id is undefined");

        const tunnelId = crypto.randomBytes(20).toString('hex');
        const tunnel = await tunnelService.create(tunnelId, account.id);

        const token = tunnel?.config.transport?.token;
        assert(token != undefined, "no connection token set");

        let res = await tunnelService.authorize(tunnelId, token);
        assert(res.authorized == true, "tunnel authorize failed with correct token");
        assert(res.account?.id == account.id, "authorize did not return account id");

        res = await tunnelService.authorize(tunnelId, "wrong-token");
        assert(res.authorized == false, "tunnel authorize succeed with incorrect token");

        await tunnelService.destroy();
    });

    it(`stopping tunnel connection manager drains existing connections`, async () => {
        const tunnelService = new TunnelService();
        const bus = new EventBus();

        const account = await accountService.create();
        assert(account instanceof Account, "did not create account");
        assert(account.id != undefined, "account id is undefined");

        const tunnelId = crypto.randomBytes(20).toString('hex');

        let tunnel = await tunnelService.create(tunnelId, account.id);
        assert(tunnel instanceof Tunnel, `tunnel not created, got ${tunnel}`);
        assert(tunnel?.id == tunnelId, `expected id ${tunnelId}, got ${tunnel?.id}`);

        const sockPair = await wsSocketPair.create();
        const transport = new WebSocketTransport({
            tunnelId: tunnelId,
            socket: sockPair.sock1,
        })

        const msgPromise = new Promise((resolve) => {
            bus.once('tunnel:announce', (msg) => {
                setImmediate(() => { resolve(msg) });
            })
        });

        let res = await tunnelService.connect(tunnelId, account.id, transport, {peer: "127.0.0.1"});
        assert(res == true, `connect did not return true, got ${res}`);

        const msg: any = await msgPromise;
        assert(msg[0]["tunnel_id"] == tunnelId, "did not get tunnel announcement");

        tunnel  = await tunnelService.lookup(tunnelId);
        assert(tunnel.state.connected == true, "tunnel state is not connected");

        await TunnelConnectionManager.stop();

        tunnel = await tunnelService.lookup(tunnelId);
        assert(tunnel.state.connected == false, "tunnel state is connected after end()");

        res = await tunnelService.connect(tunnelId, account.id, transport, {peer: "127.0.0.1"});
        assert(res == false, `connect did not return false, got ${res}`);

        await tunnelService.destroy();
        await bus.destroy();
        await transport.destroy();
        await sockPair.terminate();
    });

    it(`remote connections are re-routed`, async () => {
        const tunnelService = new TunnelService();
        const bus = new EventBus();

        const account = await accountService.create();
        assert(account instanceof Account, "did not create account");
        assert(account.id != undefined, "account id is undefined");

        const tunnelId = crypto.randomBytes(20).toString('hex');
        let tunnel = await tunnelService.create(tunnelId, account.id);
        assert(tunnel instanceof Tunnel, `tunnel not created, got ${tunnel}`);
        assert(tunnel?.id == tunnelId, `expected id ${tunnelId}, got ${tunnel?.id}`);

        sinon.stub(ClusterManager, 'getNode').returns({
            id: "node-1",
            host: "some-node-host",
            ip: "127.0.0.1",
            last_ts: new Date().getTime(),
            stale: false,
        });

        TunnelConnectionManager["learnRemoteTunnels"]([
            { tunnel_id: tunnelId,
              connections: [
                {
                    connection_id: "con-1",
                    peer: "127.0.0.1",
                    node: "node-1",
                    connected: true,
                    connected_at: Date.now(),
                }
              ]
            }
        ], {
            node: {
                id: "node-1",
                ip: "127.0.0.1",
                host: "host"
            },
            ts: Date.now()
        });

        tunnel = await tunnelService.lookup(tunnelId);
        assert(tunnel.state.connected == true);

        const server = net.createServer();
        await new Promise((resolve) => { server.listen(30000, () => { resolve(undefined) }) });

        const con = new Promise((resolve) => {
            server.on('connection', () => {
                resolve(undefined);
            });
        });

        const sock: any = await new Promise((resolve, reject) => {
            TunnelConnectionManager.createConnection(tunnelId, {
                remoteAddr: "127.0.0.2",
                ingress: {
                    port: 30000,
                }
            }, (err, sock) => {
                err ? reject() : resolve(sock);
            })
        });

        await con;
        sock.destroy();

        await tunnelService.destroy();
        await bus.destroy();
        await new Promise((resolve) => {
            server.close(() => {
                resolve(undefined);
            });
        });
    });

    it(`local connections are connected`, async () => {
        const tunnelService = new TunnelService();
        const bus = new EventBus();

        const account = await accountService.create();
        assert(account instanceof Account, "did not create account");
        assert(account.id != undefined, "account id is undefined");

        const tunnelId = crypto.randomBytes(20).toString('hex');
        let tunnel = await tunnelService.create(tunnelId, account.id);
        assert(tunnel instanceof Tunnel, `tunnel not created, got ${tunnel}`);
        assert(tunnel?.id == tunnelId, `expected id ${tunnelId}, got ${tunnel?.id}`);

        const sockPair = await wsSocketPair.create();
        const transport = new WebSocketTransport({
            tunnelId: tunnelId,
            socket: sockPair.sock1,
        });

        let res = await tunnelService.connect(tunnelId, account.id, transport, {peer: "127.0.0.1"});
        assert(res == true, `connect did not return true, got ${res}`);

        tunnel = await tunnelService.lookup(tunnelId);
        assert(tunnel.state.connected == true, "tunnel state is not connected");

        const wsm = new WebSocketMultiplex(sockPair.sock2);
        const con = new Promise((resolve) => {
            wsm.on('connection', () => {
                resolve(undefined);
            });
        });

        const sock = await new Promise((resolve, reject) => {
            TunnelConnectionManager.createConnection(tunnelId, {
                remoteAddr: "127.0.0.2",
                ingress: {
                    port: 0
                }
            }, (err, sock) => {
                err ? reject() : resolve(sock);
            })
        });

        await con;

        res = await tunnelService.disconnect(tunnelId, account.id);
        assert(res == true, "failed to disconnect tunnel");

        tunnel = await tunnelService.lookup(tunnelId);
        assert(tunnel.state.connected == false, "tunnel state is connected");

        assert(tunnel.state.connections[0].connected == false, "tunnel connection is disconnected");

        await tunnelService.destroy();
        await bus.destroy();
        await wsm.destroy();
        await transport.destroy();
        await sockPair.terminate();
    });

    it(`can not connect to tunnel on disabled account`, async () => {
        const tunnelService = new TunnelService();
        const bus = new EventBus();

        const account = await accountService.create();
        assert(account instanceof Account, "did not create account");
        assert(account.id != undefined, "account id is undefined");

        const tunnelId = crypto.randomBytes(20).toString('hex');
        let tunnel = await tunnelService.create(tunnelId, account.id);
        assert(tunnel instanceof Tunnel, `tunnel not created, got ${tunnel}`);
        assert(tunnel?.id == tunnelId, `expected id ${tunnelId}, got ${tunnel?.id}`);

        const sockPair = await wsSocketPair.create();
        const transport = new WebSocketTransport({
            tunnelId: tunnelId,
            socket: sockPair.sock1,
        })

        let authResult = await tunnelService.authorize(tunnel.id, tunnel.config.transport?.token || "");
        assert(authResult.authorized == true, "authorization failed on enabled account");

        let res = await tunnelService.connect(tunnelId, account.id, transport, {peer: "127.0.0.1"});
        assert(res == true, `connect did not return true, got ${res}`);

        tunnel = await tunnelService.lookup(tunnelId);
        assert(tunnel.state.connected == true, "tunnel state is not connected");

        await accountService.disable(account.id, true, "spam");

        tunnel = await tunnelService.lookup(tunnelId);
        assert(tunnel.state.connected == false, "tunnel state is connected");

        authResult = await tunnelService.authorize(<string>tunnel.id, tunnel.config.transport?.token || "");
        assert(authResult.authorized == false, "authorization succeeded on disabled account");

        await tunnelService.destroy();
        await bus.destroy();
        await transport.destroy();
        await sockPair.terminate();
    });
});