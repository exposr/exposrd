import assert from 'assert/strict';
import crypto from 'crypto';
import sinon from 'sinon';
import net from 'net';
import TunnelService from '../../../src/tunnel/tunnel-service.js';
import Config from '../../../src/config.js';
import ClusterService from '../../../src/cluster/index.js';
import Ingress from '../../../src/ingress/index.js';
import AccountService from '../../../src/account/account-service.js';
import Tunnel from '../../../src/tunnel/tunnel.js';
import WebSocketTransport from '../../../src/transport/ws/ws-transport.ts';
import { initStorageService, wsSocketPair } from '../test-utils.ts';
import EventBus from '../../../src/cluster/eventbus.js';
import { WebSocketMultiplex } from '@exposr/ws-multiplex';

describe('tunnel service', () => {
    let clock;
    let config;
    let storageservice;
    let clusterservice;
    let ingress;
    let accountService;

    beforeEach(async () => {
        clock = sinon.useFakeTimers({shouldAdvanceTime: true, now: 10000});
        config = new Config();
        storageservice = await initStorageService();
        clusterservice = new ClusterService('mem', {});

        ingress = await new Promise((resolve, reject) => {
            const i = new Ingress({
                callback: (e) => {
                    e ? reject(e) : resolve(i) },
                http: {
                    enabled: true,
                    subdomainUrl: new URL("https://example.com"),
                    port: 8080,
                }
            });
        });
        assert(ingress instanceof Ingress);
        accountService = new AccountService();
    });

    afterEach(async () => {
        await config.destroy();
        await storageservice.destroy();
        await clusterservice.destroy();
        await accountService.destroy();
        await ingress.destroy();
        clock.restore();
        sinon.restore();
    })

    describe(`distributed tunnel state`, async () => {
        it(`can be learnt`, async () => {
            const tunnelService = new TunnelService();
            const tunnelId = crypto.randomBytes(20).toString('hex');
            const nodeId = crypto.randomBytes(20).toString('hex');
            const nodeId2 = crypto.randomBytes(20).toString('hex');

            const connected_at = Date.now();
            await clock.tickAsync(1000);

            tunnelService["learnRemoteTunnels"]([
                { tunnel_id: tunnelId,
                  connections: [
                    {
                        connection_id: "con-1",
                        peer: "127.0.0.2",
                        node: nodeId,
                        connected: true,
                        connected_at: connected_at - 1000,
                    },
                    {
                        connection_id: "con-2",
                        peer: "127.0.0.2",
                        node: nodeId,
                        connected: true,
                        connected_at: connected_at - 2000,
                    }
                  ]
                }
            ], {
                node: {
                    id: nodeId,
                    ip: "127.0.0.1",
                    host: "host"
                },
                ts: Date.now()
            });

            let state = tunnelService["connectedTunnels"][tunnelId];
            assert(state.connected == true, "not in connected state");
            assert(state.connected_at == connected_at - 2000, "wrong connected_at timestamp");
            assert(state.connections[0].connected == true, "con-1 not marked as connected");
            assert(state.connections[1].connected == true, "con-2 not marked as connected");
            assert(state.alive_connections == 2, "unexpected number of connections");

            tunnelService["learnRemoteTunnels"]([
                { tunnel_id: tunnelId,
                  connections: [
                    {
                        connection_id: "con-3",
                        peer: "127.0.0.2",
                        node: nodeId2,
                        connected: true,
                        connected_at: connected_at - 500,
                    }
                  ]
                }
            ], {
                node: {
                    id: nodeId2,
                    ip: "127.0.0.5",
                    host: "host"
                },
                ts: Date.now()
            });

            state = tunnelService["connectedTunnels"][tunnelId];
            assert(state.connected == true, "not in connected state");
            assert(state.connected_at == connected_at - 2000, "wrong connected_at timestamp");
            assert(state.connections[0].connected == true, "con-1 not marked as connected");
            assert(state.connections[1].connected == true, "con-2 not marked as connected");
            assert(state.connections[2].connected == true, "con-3 not marked as connected");
            assert(state.alive_connections == 3, "unexpected number of connections");

            const disconnected_at = Date.now();
            tunnelService["learnRemoteTunnels"]([
                { tunnel_id: tunnelId,
                  connections: [
                    {
                        connection_id: "con-1",
                        peer: "127.0.0.2",
                        node: nodeId,
                        connected: false,
                        connected_at: connected_at - 1000,
                        disconnected_at: disconnected_at,
                    },
                    {
                        connection_id: "con-2",
                        peer: "127.0.0.2",
                        node: nodeId,
                        connected: true,
                        connected_at: connected_at - 2000,
                    }
                  ]
                }
            ], {
                node: {
                    id: nodeId,
                    ip: "127.0.0.1",
                    host: "host"
                },
                ts: Date.now()
            });

            state = tunnelService["connectedTunnels"][tunnelId];
            assert(state.connected == true, "not in connected state");
            assert(state.connected_at == connected_at - 2000, "wrong connected_at timestamp");
            assert(state.connections.find((tc) => tc.connection_id == 'con-1').connected == false, "con-1 not marked as connected");
            assert(state.connections.find((tc) => tc.connection_id == 'con-2').connected == true, "con-2 not marked as connected");
            assert(state.connections.find((tc) => tc.connection_id == 'con-3').connected == true, "con-3 not marked as connected");
            assert(state.alive_connections == 2, "unexpected number of connections");

            tunnelService["learnRemoteTunnels"]([
                { tunnel_id: tunnelId,
                  connections: [
                    {
                        connection_id: "con-1",
                        peer: "127.0.0.2",
                        node: nodeId,
                        connected: false,
                        connected_at: connected_at - 1000,
                        disconnected_at: disconnected_at,
                    },
                    {
                        connection_id: "con-2",
                        peer: "127.0.0.2",
                        node: nodeId,
                        connected: false,
                        disconnected_at: disconnected_at + 1000,
                        connected_at: connected_at - 2000,
                    }
                  ]
                }
            ], {
                node: {
                    id: nodeId,
                    ip: "127.0.0.1",
                    host: "host"
                },
                ts: Date.now()
            });

            tunnelService["learnRemoteTunnels"]([
                { tunnel_id: tunnelId,
                  connections: [
                    {
                        connection_id: "con-3",
                        peer: "127.0.0.2",
                        node: nodeId2,
                        connected: false,
                        connected_at: connected_at - 500,
                        disconnected_at: disconnected_at + 1500,
                    }
                  ]
                }
            ], {
                node: {
                    id: nodeId2,
                    ip: "127.0.0.5",
                    host: "host"
                },
                ts: Date.now()
            });

            state = tunnelService["connectedTunnels"][tunnelId];
            assert(state.connected == false, "in connected state");
            assert(state.connected_at == connected_at - 2000, "wrong connected_at timestamp");
            assert(state.disconnected_at == disconnected_at + 1500, "wrong disconnected_at timestamp");
            assert(state.alive_connections == 0, "unexpected number of connections");

            await tunnelService.destroy();
        });

        it(`remote connections are marked as disconnected on timeout`, async () => {
            const tunnelService = new TunnelService();
            const tunnelId = crypto.randomBytes(20).toString('hex');
            const nodeId = crypto.randomBytes(20).toString('hex');

            const connected_at = Date.now();
            tunnelService["learnRemoteTunnels"]([
                { tunnel_id: tunnelId,
                  connections: [
                    {
                        connection_id: "con-1",
                        peer: "127.0.0.2",
                        node: nodeId,
                        connected: true,
                        connected_at: connected_at - 500,
                    }
                  ]
                }
            ], {
                node: {
                    id: nodeId,
                    ip: "127.0.0.5",
                    host: "host"
                },
                ts: Date.now()
            });

            let state = tunnelService.connectedTunnels[tunnelId];
            assert(state.connected == true, "not in connected state");
            assert(state.connections[0].connected == true, "con-1 not marked as connected");

            await clock.tickAsync(tunnelService.stateRefreshInterval + tunnelService.tunnelConnectionAliveThreshold);
            state = tunnelService.connectedTunnels[tunnelId];

            assert(state.connected == false, "in connected state");
            assert(state.connections[0].connected == false, "con-1 marked as connected");
            assert(state.alive_connections == 0, "wrong expected number of connections");

            await tunnelService.destroy();
        });

        it(`disconnected connections are removed on removal timeout`, async () => {
            const tunnelService = new TunnelService();
            const tunnelId = crypto.randomBytes(20).toString('hex');
            const nodeId = crypto.randomBytes(20).toString('hex');

            const connected_at = Date.now();
            tunnelService["learnRemoteTunnels"]([
                { tunnel_id: tunnelId,
                  connections: [
                    {
                        connection_id: "con-1",
                        peer: "127.0.0.2",
                        node: nodeId,
                        connected: false,
                        connected_at: connected_at - 500,
                        disconnected_at: connected_at,
                    },
                    {
                        connection_id: "con-2",
                        peer: "127.0.0.2",
                        node: nodeId,
                        connected: true,
                        connected_at: connected_at - 500,
                    }
                  ]
                }
            ], {
                node: {
                    id: nodeId,
                    ip: "127.0.0.5",
                    host: "host"
                },
                ts: Date.now()
            });

            let state = tunnelService.connectedTunnels[tunnelId];

            assert(state.connected == true, "not in connected state");
            assert(state.connections[0].connected == false);
            assert(state.connections[1].connected == true);
            assert(state.connections.length == 2);

            await clock.tickAsync(tunnelService.tunnelConnectionAliveThreshold + tunnelService.stateRefreshInterval);
            state = tunnelService.connectedTunnels[tunnelId];
            assert(state.connected == false, "in connected state");
            assert(state.connections.length == 2);

            state.connections[0].connected = true;
            state.connections[0].alive_at = Date.now() + tunnelService.tunnelConnectionRemoveThreshold;

            await clock.tickAsync(tunnelService.tunnelConnectionRemoveThreshold + tunnelService.stateRefreshInterval);
            state = tunnelService.connectedTunnels[tunnelId];
            assert(state.connected == true, "not in connected state");
            assert(state.connections[0].connected == true);
            assert(state.connections.length == 1);

            await tunnelService.destroy();
        });

        it(`getNextConnection prefers local connections`, async () => {
            const tunnelService = new TunnelService();
            const tunnelId = crypto.randomBytes(20).toString('hex');

            tunnelService.connectedTunnels[tunnelId] = {
                connected: true,
                connected_at: Date.now(),
                connections: [
                    {
                        connection_id: "con-1",
                        node: "node-1",
                        peer: "127.0.0.1",
                        local: false,
                        connected: true,
                        connected_at: Date.now(),
                        alive_at: Date.now(),
                    },
                    {
                        connection_id: "con-2",
                        node: "node-2",
                        peer: "127.0.0.1",
                        local: true,
                        connected: true,
                        connected_at: Date.now(),
                        alive_at: Date.now(),
                    }
                ]
            };

            let nextCon = tunnelService["getNextConnection"](tunnelId);
            assert(nextCon.connection_id == "con-2", `getNextConnection did not return local connection got ${nextCon}`);

            nextCon = tunnelService["getNextConnection"](tunnelId);
            assert(nextCon.connection_id == "con-2", `getNextConnection did not return local connection got ${nextCon}`);
            await tunnelService.destroy();
        });

        it(`getNextConnection round-robins local connections`, async () => {
            const tunnelService = new TunnelService();
            const tunnelId = crypto.randomBytes(20).toString('hex');

            tunnelService.connectedTunnels[tunnelId] = {
                connected: true,
                connected_at: Date.now(),
                connections: [
                    {
                        connection_id: "con-1",
                        node: "node-1",
                        peer: "127.0.0.1",
                        local: true,
                        connected: true,
                        connected_at: Date.now(),
                        alive_at: Date.now(),
                    },
                    {
                        connection_id: "con-2",
                        node: "node-2",
                        peer: "127.0.0.1",
                        local: true,
                        connected: true,
                        connected_at: Date.now(),
                        alive_at: Date.now(),
                    }
                ]
            };

            let nextCon = tunnelService["getNextConnection"](tunnelId);
            assert(nextCon.connection_id == "con-1", `getNextConnection did not return local connection got ${nextCon}`);

            nextCon = tunnelService["getNextConnection"](tunnelId);
            assert(nextCon.connection_id == "con-2", `getNextConnection did not return local connection got ${nextCon}`);

            nextCon = tunnelService["getNextConnection"](tunnelId);
            assert(nextCon.connection_id == "con-1", `getNextConnection did not return local connection got ${nextCon}`);

            await tunnelService.destroy();
        });

        it(`getNextConnection selects remote node if no local connections`, async () => {
            const tunnelService = new TunnelService();
            const tunnelId = crypto.randomBytes(20).toString('hex');

            tunnelService.connectedTunnels[tunnelId] = {
                connected: true,
                connected_at: Date.now(),
                connections: [
                    {
                        connection_id: "con-1",
                        node: "node-1",
                        peer: "127.0.0.1",
                        local: false,
                        connected: true,
                        connected_at: Date.now(),
                        alive_at: Date.now(),
                    },
                    {
                        connection_id: "con-2",
                        node: "node-2",
                        peer: "127.0.0.1",
                        local: false,
                        connected: true,
                        connected_at: Date.now(),
                        alive_at: Date.now(),
                    }
                ]
            };

            let nextCon = tunnelService["getNextConnection"](tunnelId);
            assert(nextCon.connection_id == "con-1", `getNextConnection did not return connection got ${nextCon}`);

            await tunnelService.destroy();
        });

        it(`getNextConnection round-robins remote nodes`, async () => {
            const tunnelService = new TunnelService();
            const tunnelId = crypto.randomBytes(20).toString('hex');

            tunnelService.connectedTunnels[tunnelId] = {
                connected: true,
                connected_at: Date.now(),
                connections: [
                    {
                        connection_id: "con-1",
                        node: "node-1",
                        peer: "127.0.0.1",
                        local: false,
                        connected: true,
                        connected_at: Date.now(),
                        alive_at: Date.now(),
                    },
                    {
                        connection_id: "con-2",
                        node: "node-2",
                        peer: "127.0.0.1",
                        local: false,
                        connected: true,
                        connected_at: Date.now(),
                        alive_at: Date.now(),
                    }
                ]
            };

            let nextCon = tunnelService["getNextConnection"](tunnelId);
            assert(nextCon.connection_id == "con-1", `getNextConnection did not return connection got ${nextCon}`);

            nextCon = tunnelService["getNextConnection"](tunnelId);
            assert(nextCon.connection_id == "con-2", `getNextConnection did not return connection got ${nextCon}`);

            nextCon = tunnelService["getNextConnection"](tunnelId);
            assert(nextCon.connection_id == "con-1", `getNextConnection did not return connection got ${nextCon}`);

            await tunnelService.destroy();
        });

        it(`getNextConnection returns undefined if no connections`, async () => {
            const tunnelService = new TunnelService();
            const tunnelId = crypto.randomBytes(20).toString('hex');

            let nextCon = tunnelService["getNextConnection"](tunnelId);
            assert(nextCon == undefined, `getNextConnection dit not return undefined`);

            await tunnelService.destroy();
        });

        it(`local tunnels are periodically announced`, async () => {
            const tunnelService = new TunnelService();
            const bus = new EventBus();

            for (let i = 0; i < tunnelService.tunnelAnnounceBatchSize * 1.5; i++) {
                const tunnelId = crypto.randomBytes(20).toString('hex');
                const cid = `${tunnelId}-con-1`;

                tunnelService.connectedTunnels[tunnelId] = {
                    connected: true,
                    connected_at: Date.now(),
                    connections: [
                        {
                            connection_id: cid,
                            node: "node-1",
                            peer: "127.0.0.1",
                            local: true,
                            connected: true,
                            connected_at: Date.now(),
                            alive_at: Date.now(),
                        }
                    ]
                };
            }

            const expectedAnnouncements = Math.ceil(Object.keys(tunnelService.connectedTunnels).length / tunnelService.tunnelAnnounceBatchSize);
            let announcements = 0;
            bus.on('tunnel:announce', (msg) => {
                announcements++;
            });

            await clock.tickAsync(tunnelService.tunnelAnnounceInterval + 1000);
            assert(announcements == expectedAnnouncements, `expected ${expectedAnnouncements} batch announcements, got ${announcements}`);

            await bus.destroy();
            await tunnelService.destroy();
        });
    });

    it(`can create new tunnel`, async () => {
        const tunnelService = new TunnelService();

        const account = await accountService.create();
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
        const tunnelId = crypto.randomBytes(20).toString('hex');

        let tunnel = await tunnelService.create(tunnelId, account.id);

        assert(tunnel instanceof Tunnel, `tunnel not created, got ${tunnel}`);
        assert(tunnel?.id == tunnelId, `expected id ${tunnelId}, got ${tunnel?.id}`);

        account = await accountService.get(account.id);
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
        } catch (e) {
            assert(e.message == 'no_such_tunnel', `tunnel not deleted, got ${e.message}`);
        }

        account = await accountService.get(account.id);
        assert(account.tunnels.indexOf(tunnelId) == -1, "tunnel listed on account after deletion");

        await tunnelService.destroy();
    });

    it(`can list tunnels`, async () => {
        const tunnelService = new TunnelService();
        let account = await accountService.create();

        for (let i = 0; i < 100; i++) {
            const tunnelId = crypto.randomBytes(20).toString('hex');
            await tunnelService.create(tunnelId, account.id);
        }

        const expectedTunnels = 100;

        let cursor;
        let tunnels = 0;
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
        const tunnelId = crypto.randomBytes(20).toString('hex');

        let tunnel = await tunnelService.create(tunnelId, account.id);
        assert(tunnel instanceof Tunnel, `tunnel not created, got ${tunnel}`);
        assert(tunnel?.id == tunnelId, `expected id ${tunnelId}, got ${tunnel?.id}`);

        const sockPair = await wsSocketPair.create();
        const transport = new WebSocketTransport({
            tunnelId: tunnelId,
            socket: sockPair.sock1,
        })

        const msg = new Promise((resolve) => {
            bus.once('tunnel:announce', (msg) => {
                setImmediate(() => { resolve(msg) });
            })
        });

        let res = await tunnelService.connect(tunnelId, account.id, transport, {peer: "127.0.0.1"});
        assert(res == true, `connect did not return true, got ${res}`);

        await msg;
        assert(msg.tunnel != tunnelId, "did not get tunnel announcement");

        tunnel = await tunnelService.lookup(tunnelId);
        assert(tunnel.state.connected == true, "tunnel state is not connected");

        const localCon = tunnelService.isLocalConnected(tunnelId);
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
        const tunnelId = crypto.randomBytes(20).toString('hex');

        let tunnel = await tunnelService.create(tunnelId, account.id);
        assert(tunnel instanceof Tunnel, `tunnel not created, got ${tunnel}`);
        assert(tunnel?.id == tunnelId, `expected id ${tunnelId}, got ${tunnel?.id}`);

        const sockPair1 = await wsSocketPair.create(10000);
        const transport1 = new WebSocketTransport({
            tunnelId: tunnelId,
            socket: sockPair1.sock1,
            max_connections: 2,
        })

        let res = await tunnelService.connect(tunnelId, account.id, transport1, {peer: "127.0.0.1"});
        assert(res == true, `connect did not return true, got ${res}`);

        const sockPair2 = await wsSocketPair.create(10001);
        const transport2 = new WebSocketTransport({
            tunnelId: tunnelId,
            socket: sockPair2.sock1,
            max_connections: 2,
        })

        res = await tunnelService.connect(tunnelId, account.id, transport2, {peer: "127.0.0.1"});
        assert(res == true, `connect did not return true, got ${res}`);

        tunnel = await tunnelService.lookup(tunnelId);
        assert(tunnel.state.connected == true, "tunnel state is not connected");
        assert(tunnel.state.alive_connections == 2);
        assert(tunnel.state.connections.length == 2)
        assert(tunnel.state.connections[0].connected == true);
        assert(tunnel.state.connections[1].connected == true);

        let tunnelConnection1 = tunnelService["getNextConnection"](tunnelId);
        let tunnelConnection2 = tunnelService["getNextConnection"](tunnelId);
        assert(tunnelConnection1.connection_id != tunnelConnection2.connection_id, "getNextConnection repeated connection");

        let tunnelConnection3 = tunnelService["getNextConnection"](tunnelId);
        assert(tunnelConnection1.connection_id == tunnelConnection3.connection_id, "getNextConnection did not wrap around");
        let tunnelConnection4 = tunnelService["getNextConnection"](tunnelId);
        assert(tunnelConnection2.connection_id == tunnelConnection4.connection_id, "getNextConnection did not wrap around");

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
        const tunnelId = crypto.randomBytes(20).toString('hex');
        const tunnel = await tunnelService.create(tunnelId, account.id);

        const token = tunnel?.config.transport?.token;
        assert(token != undefined, "no connection token set");

        let res = await tunnelService.authorize(tunnelId, token);
        assert(res.authorized == true, "tunnel authorize failed with correct token");
        assert(res.account.id == account.id, "authorize did not return account id");

        res = await tunnelService.authorize(tunnelId, "wrong-token");
        assert(res.authorized == false, "tunnel authorize succeed with incorrect token");

        await tunnelService.destroy();
    });

    it(`calling end() drains existing connections`, async () => {
        const tunnelService = new TunnelService();
        const bus = new EventBus();

        const account = await accountService.create();
        const tunnelId = crypto.randomBytes(20).toString('hex');

        let tunnel = await tunnelService.create(tunnelId, account.id);
        assert(tunnel instanceof Tunnel, `tunnel not created, got ${tunnel}`);
        assert(tunnel?.id == tunnelId, `expected id ${tunnelId}, got ${tunnel?.id}`);

        const sockPair = await wsSocketPair.create();
        const transport = new WebSocketTransport({
            tunnelId: tunnelId,
            socket: sockPair.sock1,
        })

        const msg = new Promise((resolve) => {
            bus.once('tunnel:announce', (msg) => {
                setImmediate(() => { resolve(msg) });
            })
        });

        let res = await tunnelService.connect(tunnelId, account.id, transport, {peer: "127.0.0.1"});
        assert(res == true, `connect did not return true, got ${res}`);

        res = await msg;
        assert(res[0]["tunnel_id"] == tunnelId, "did not get tunnel announcement");

        tunnel  = await tunnelService.lookup(tunnelId);
        assert(tunnel.state.connected == true, "tunnel state is not connected");

        await tunnelService.end();

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
        const tunnelId = crypto.randomBytes(20).toString('hex');

        let tunnel = await tunnelService.create(tunnelId, account.id);
        assert(tunnel instanceof Tunnel, `tunnel not created, got ${tunnel}`);
        assert(tunnel?.id == tunnelId, `expected id ${tunnelId}, got ${tunnel?.id}`);

        sinon.stub(ClusterService.prototype, 'getNode').returns({
            id: "node-1",
            host: "some-node-host",
            ip: "127.0.0.1",
            last_ts: new Date().getTime(),
            stale: false,
        });

        tunnelService["learnRemoteTunnels"]([
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
        await new Promise((resolve) => { server.listen(30000, () => { resolve() }) });

        const con = new Promise((resolve) => {
            server.on('connection', () => {
                resolve();
            });
        });

        const sock = await new Promise((resolve, reject) => {
            tunnelService.createConnection(tunnelId, {
                ingress: { port: 30000 }
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
                resolve();
            });
        });

        const sock = await new Promise((resolve, reject) => {
            tunnelService.createConnection(tunnelId, {
                ingress: { port: 0 }
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
});