import assert from 'assert/strict';
import crypto from 'crypto';
import sinon from 'sinon';
import TunnelService from '../../../src/tunnel/tunnel-service.js';
import Config from '../../../src/config.js';
import { StorageService } from '../../../src/storage/index.js';
import ClusterService from '../../../src/cluster/index.js';
import Ingress from '../../../src/ingress/index.js';
import AccountService from '../../../src/account/account-service.js';
import Tunnel from '../../../src/tunnel/tunnel.js';
import WebSocketTransport from '../../../src/transport/ws/ws-transport.js';
import { socketPair } from '../test-utils.js';
import EventBus from '../../../src/cluster/eventbus.js';

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
        storageservice = new StorageService('mem', {});
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
    })

    describe(`distributed tunnel state`, async () => {
        it(`can be learnt`, async () => {
            const tunnelService = new TunnelService();
            const tunnelId = crypto.randomBytes(20).toString('hex');
            const nodeId = crypto.randomBytes(20).toString('hex');
            const nodeId2 = crypto.randomBytes(20).toString('hex');

            const connected_at = Date.now();
            tunnelService._tunnels.learn(tunnelId, [
                { id: "con-1", connected_at: connected_at - 1000 },
                { id: "con-2", connected_at: connected_at - 2000 }
            ], {
                node: { id: nodeId },
                ts: Date.now(),
            });

            const state = tunnelService._tunnels.state.tunnels[tunnelId];

            assert(state.connected == true, "not in connected state");
            assert(state.connected_at = connected_at - 2000, "wrong connected_at timestamp");
            assert(state.connections["con-1"].alive == true, "con-1 not marked as alive");
            assert(state.connections["con-2"].alive == true, "con-2 not marked as alive");
            assert(Object.keys(state.connections).length == 2, "unexpected number of connections");

            tunnelService._tunnels.learn(tunnelId, [
                { id: "con-3", connected_at: connected_at },
            ], {
                node: { id: nodeId2 },
                ts: Date.now(),
            });

            assert(state.connected == true, "not in connected state");
            assert(state.connected_at = connected_at - 2000, "wrong connected_at timestamp");
            assert(state.connections["con-1"].alive == true, "con-1 not marked as alive");
            assert(state.connections["con-2"].alive == true, "con-2 not marked as alive");
            assert(state.connections["con-3"].alive == true, "con-3 not marked as alive");
            assert(Object.keys(state.connections).length == 3, "unexpected number of connections");

            tunnelService._tunnels.learn(tunnelId, [
                { id: "con-2", connected_at: connected_at - 2000 }
            ], {
                node: { id: nodeId },
                ts: Date.now(),
            });

            assert(state.connected == true, "not in connected state");
            assert(state.connected_at = connected_at - 2000, "wrong connected_at timestamp");
            assert(state.connections["con-1"].alive == false, "con-1 not marked as dead");
            assert(state.connections["con-2"].alive == true, "con-2 not marked as alive");
            assert(state.connections["con-3"].alive == true, "con-3 not marked as alive");

            const disconnected_at = Date.now();
            tunnelService._tunnels.learn(tunnelId, [ ], {
                node: { id: nodeId },
                ts: disconnected_at,
            });

            tunnelService._tunnels.learn(tunnelId, [ ], {
                node: { id: nodeId2 },
                ts: disconnected_at,
            });

            assert(state.connected == false, "not in disconnected state");
            assert(state.disconnected_at = disconnected_at, "wrong disconnected_at timestamp");
            assert(state.connections["con-1"].alive == false, "con-1 not marked as dead");
            assert(state.connections["con-2"].alive == false, "con-2 not marked as dead");
            assert(state.connections["con-3"].alive == false, "con-3 not marked as dead");

            await tunnelService.destroy();
        });

        it(`connections are marked as dead on timeout`, async () => {
            const tunnelService = new TunnelService();
            const tunnelId = crypto.randomBytes(20).toString('hex');
            const nodeId = crypto.randomBytes(20).toString('hex');

            const connected_at = Date.now();
            tunnelService._tunnels.learn(tunnelId, [
                { id: "con-1", connected_at: connected_at - 1000 },
            ], {
                node: { id: nodeId },
                ts: Date.now(),
            });
            const state = tunnelService._tunnels.state.tunnels[tunnelId];

            assert(state.connected == true, "not in connected state");
            assert(state.connections["con-1"].alive == true, "con-1 not marked as alive");

            await clock.tickAsync(tunnelService.tunnelConnectionAliveThreshold + tunnelService.tunnelDeadSweepInterval);

            assert(state.connected == false, "not in disconnected state");
            assert(state.connections["con-1"].alive == false, "con-1 not marked as dead");

            await tunnelService.destroy();
        });

        it(`dead connections are removed on delete timeout`, async () => {
            const tunnelService = new TunnelService();
            const tunnelId = crypto.randomBytes(20).toString('hex');
            const nodeId = crypto.randomBytes(20).toString('hex');

            const connected_at = Date.now();
            tunnelService._tunnels.learn(tunnelId, [
                { id: "con-1", connected_at: connected_at - 1000 },
            ], {
                node: { id: nodeId },
                ts: Date.now(),
            });
            const state = tunnelService._tunnels.state.tunnels[tunnelId];

            assert(state.connected == true, "not in connected state");
            assert(state.connections["con-1"].alive == true, "con-1 not marked as alive");

            await clock.tickAsync(tunnelService.tunnelConnectionDeleteThreshold + tunnelService.tunnelDeleteSweepInterval);

            assert(state.connected == false, "not in disconnected state");
            assert(Object.keys(state.connections).length == 0, "connection not removed");

            await tunnelService.destroy();
        });

        it(`local connections are marked as local`, async () => {
            const tunnelService = new TunnelService();
            const tunnelId = crypto.randomBytes(20).toString('hex');
            const nodeId = crypto.randomBytes(20).toString('hex');

            const connected_at = Date.now();
            tunnelService._connectedTunnels[tunnelId] = {
                connections: {
                    "con-1": {}
                }
            };

            tunnelService._tunnels.learn(tunnelId, [
                { id: "con-1", connected_at: connected_at - 1000 },
            ], {
                node: { id: nodeId },
                ts: Date.now(),
            });
            const state = tunnelService._tunnels.state.tunnels[tunnelId];

            assert(state.connected == true, "not in connected state");
            assert(state.connections["con-1"].alive == true, "con-1 not marked as alive");
            assert(state.connections["con-1"].local == true, "con-1 not marked as local");

            await tunnelService.destroy();
        });

        it(`returns external state`, async () => {
            const tunnelService = new TunnelService();
            const tunnelId = crypto.randomBytes(20).toString('hex');
            const nodeId = crypto.randomBytes(20).toString('hex');

            const connected_at = Date.now() - 1000;
            const alive_at = Date.now();
            tunnelService._tunnels.learn(tunnelId, [
                { id: "con-1", connected_at: connected_at, peer: "127.0.0.1" },
                { id: "con-2", connected_at: connected_at + 50, peer: "127.0.0.2" },
            ], {
                node: { id: nodeId },
                ts: alive_at,
            });
            const xstate = tunnelService._tunnels.getState(tunnelId)

            assert(xstate.connected == true, "not in connected state");
            assert(xstate.connected_at == new Date(connected_at).toISOString(), "wrong connected_at");
            assert(xstate.disconnected_at == undefined, "disconnected_at set when not expected");
            assert(xstate.alive_at == new Date(alive_at).toISOString(), "wrong alive_at");
            assert(xstate.connections.length == 2, "unexpected number of connections");
            assert(xstate.connections[0].peer == "127.0.0.1", "unexpected connection peer");
            assert(xstate.connections[0].connected_at == connected_at, "unexpected connection connected_at");
            assert(xstate.connections[1].peer == "127.0.0.2", "unexpected connection peer");
            assert(xstate.connections[1].connected_at == connected_at + 50, "unexpected connection connected_at");

            await tunnelService.destroy();
        });

        it(`getNextConnection prefers local connections`, async () => {
            const tunnelService = new TunnelService();
            const tunnelId = crypto.randomBytes(20).toString('hex');
            const nodeId = crypto.randomBytes(20).toString('hex');

            const connected_at = Date.now();
            tunnelService._connectedTunnels[tunnelId] = {
                connections: {
                    "local-con-1": {}
                }
            };

            tunnelService._tunnels.learn(tunnelId, [
                { id: "con-2", connected_at: connected_at },
            ], {
                node: { id: nodeId },
                ts: Date.now(),
            });

            let nextCon = tunnelService._tunnels.getNextConnection(tunnelId);
            assert(nextCon.cid == "local-con-1", `getNextConnection did not return local connection got ${nextCon}`);

            nextCon = tunnelService._tunnels.getNextConnection(tunnelId);
            assert(nextCon.cid == "local-con-1", `getNextConnection did not return local connection got ${nextCon}`);
            await tunnelService.destroy();
        });

        it(`getNextConnection round-robins local connections`, async () => {
            const tunnelService = new TunnelService();
            const tunnelId = crypto.randomBytes(20).toString('hex');
            const nodeId = crypto.randomBytes(20).toString('hex');

            const connected_at = Date.now();
            tunnelService._connectedTunnels[tunnelId] = {
                connections: {
                    "local-con-1": {},
                    "local-con-2": {},
                }
            };

            tunnelService._tunnels.learn(tunnelId, [
                { id: "con-3", connected_at: connected_at },
            ], {
                node: { id: nodeId },
                ts: Date.now(),
            });

            let nextCon = tunnelService._tunnels.getNextConnection(tunnelId);
            assert(nextCon.cid == "local-con-1", `getNextConnection did not return local connection got ${nextCon}`);

            nextCon = tunnelService._tunnels.getNextConnection(tunnelId);
            assert(nextCon.cid == "local-con-2", `getNextConnection did not return local connection got ${nextCon}`);

            nextCon = tunnelService._tunnels.getNextConnection(tunnelId);
            assert(nextCon.cid == "local-con-1", `getNextConnection did not return local connection got ${nextCon}`);

            await tunnelService.destroy();
        });

        it(`getNextConnection selects remote node if no local connections`, async () => {
            const tunnelService = new TunnelService();
            const tunnelId = crypto.randomBytes(20).toString('hex');
            const nodeId = crypto.randomBytes(20).toString('hex');

            const connected_at = Date.now();
            tunnelService._connectedTunnels[tunnelId] = {
                connections: {}
            };

            tunnelService._tunnels.learn(tunnelId, [
                { id: "con-3", connected_at: connected_at },
            ], {
                node: { id: nodeId },
                ts: Date.now(),
            });

            let nextCon = tunnelService._tunnels.getNextConnection(tunnelId);
            assert(nextCon.node == nodeId, `getNextConnection did not return remote node got ${nextCon}`);

            await tunnelService.destroy();
        });

        it(`getNextConnection round-robins remote nodes`, async () => {
            const tunnelService = new TunnelService();
            const tunnelId = crypto.randomBytes(20).toString('hex');
            const nodeId = crypto.randomBytes(20).toString('hex');
            const nodeId2 = crypto.randomBytes(20).toString('hex');

            const connected_at = Date.now();
            tunnelService._connectedTunnels[tunnelId] = {
                connections: {}
            };

            tunnelService._tunnels.learn(tunnelId, [
                { id: "con-1", connected_at: connected_at },
                { id: "con-2", connected_at: connected_at },
            ], {
                node: { id: nodeId },
                ts: Date.now(),
            });

            tunnelService._tunnels.learn(tunnelId, [
                { id: "con-3", connected_at: connected_at },
            ], {
                node: { id: nodeId2 },
                ts: Date.now(),
            });


            let nextCon = tunnelService._tunnels.getNextConnection(tunnelId);
            assert(nextCon.node == nodeId, `getNextConnection did not return remote node got ${nextCon}`);

            nextCon = tunnelService._tunnels.getNextConnection(tunnelId);
            assert(nextCon.node == nodeId2, `getNextConnection did not return remote node got ${nextCon}`);

            await tunnelService.destroy();
        });

        it(`getNextConnection returns undefined if no connections`, async () => {
            const tunnelService = new TunnelService();
            const tunnelId = crypto.randomBytes(20).toString('hex');

            const nextCon = tunnelService._tunnels.getNextConnection(tunnelId);
            assert(nextCon == undefined, `getNextConnection dit not return undefined`);

            await tunnelService.destroy();
        });

        it(`local tunnels are periodically announced`, async () => {
            const tunnelService = new TunnelService();
            const bus = new EventBus();

            const connected_at = Date.now();
            for (let i = 0; i < tunnelService.tunnelAnnounceBatchSize * 1.5; i++) {
                const tunnelId = crypto.randomBytes(20).toString('hex');
                const connections = {};
                const cid = `${tunnelId}-con-1`;
                connections[cid] = {
                    id: cid,
                    state: {
                        peer: "127.0.0.1",
                        connected_at: connected_at,
                    }
                };
                tunnelService._connectedTunnels[tunnelId] = {
                    connections
                }
            }

            const expectedAnnouncements = Math.ceil(Object.keys(tunnelService._connectedTunnels).length / tunnelService.tunnelAnnounceBatchSize);
            let announcements = 0;
            bus.on('tunnel:announce', (msg) => {
                announcements++;
            });

            await clock.tickAsync(tunnelService.tunnelAnnounceInterval + 1000);
            assert(announcements == expectedAnnouncements, `expected ${expectedAnnouncements} batch announcements, got ${announcements}`);

            Object.keys(tunnelService._connectedTunnels).forEach((tunnelId) => {
                const tunnel = tunnelService._tunnels.get(tunnelId);
                assert(tunnel != undefined, `tunnel ${tunnelId} not learnt in the global state`);
                assert(tunnel.connected == true, `tunnel ${tunnelId} not marked as connected in global state`);
            });

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

        await tunnelService.destroy();
    });

    it(`can create and delete tunnel`, async () => {
        const tunnelService = new TunnelService();

        let account = await accountService.create();
        const tunnelId = crypto.randomBytes(20).toString('hex');

        let tunnel = await tunnelService.create(tunnelId, account.id);

        assert(tunnel instanceof Tunnel, `tunnel not created, got ${tunnel}`);
        assert(tunnel?.id == tunnelId, `expected id ${tunnelId}, got ${tunnel?.id}`);

        account = await accountService.get(account.id);
        assert(account.tunnels.indexOf(tunnelId) != -1, "account does not own created tunnel");

        let res = await tunnelService.delete(tunnelId, account.id);
        assert(res == true, `tunnel not deleted, got ${res}`);

        tunnel = await tunnelService.get(tunnelId, account.id);
        assert(tunnel == false, `tunnel not deleted, got ${tunnel}`);

        account = await accountService.get(account.id);
        assert(account.tunnels.indexOf(tunnelId) == -1, "tunnel listed on account after deletion");

        await tunnelService.destroy();
    });

    it(`can connect and disconnect tunnel`, async () => {
        const tunnelService = new TunnelService();
        const bus = new EventBus();

        const account = await accountService.create();
        const tunnelId = crypto.randomBytes(20).toString('hex');

        const tunnel = await tunnelService.create(tunnelId, account.id);
        assert(tunnel instanceof Tunnel, `tunnel not created, got ${tunnel}`);
        assert(tunnel?.id == tunnelId, `expected id ${tunnelId}, got ${tunnel?.id}`);

        const [sock1, sock2] = socketPair();
        sock1.close = sock1.destroy;
        const transport = new WebSocketTransport({
            tunnelId: tunnelId,
            socket: sock1,
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

        let state = await tunnelService._tunnels.get(tunnelId);
        assert(state.connected == true, "tunnel state is not connected");

        res = await tunnelService.disconnect(tunnelId, account.id);
        assert(res == true, "failed to disconnect tunnel");

        state = await tunnelService._tunnels.get(tunnelId);
        assert(state.connected == false, "tunnel state is connected");

        await tunnelService.destroy();
        await bus.destroy();
        await transport.destroy();
    });

    it(`can authorize a tunnel`, async () => {
        const tunnelService = new TunnelService();
        const account = await accountService.create();
        const tunnelId = crypto.randomBytes(20).toString('hex');
        const tunnel = await tunnelService.create(tunnelId, account.id);

        const token = tunnel?.transport?.token;
        assert(token != undefined, "no connection token set");

        let res = await tunnelService.authorize(tunnelId, token);
        assert(res.authorized == true, "tunnel authorize failed with correct token");
        assert(res.account.id == account.id, "authorize did not return account id");

        res = await tunnelService.authorize(tunnelId, "wrong-token");
        assert(res.authorized == false, "tunnel authorize succeed with incorrect token");

        await tunnelService.destroy();
    });

});