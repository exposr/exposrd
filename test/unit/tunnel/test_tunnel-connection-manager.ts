import assert from 'assert/strict';
import sinon from 'sinon';
import crypto from 'crypto';
import TunnelConnectionManager from '../../../src/tunnel/tunnel-connection-manager.js';
import EventBus from '../../../src/cluster/eventbus.js';
import Config from '../../../src/config.js';
import { initStorageService } from '../test-utils.js';
import { StorageService } from '../../../src/storage/index.js';
import ClusterService from '../../../src/cluster/index.js';

describe('tunnel connection manager', () => {
    let config: Config;
    let storageService: StorageService;
    let clusterService: ClusterService;
    let clock: sinon.SinonFakeTimers;

    beforeEach(async () => {
        clock = sinon.useFakeTimers({shouldAdvanceTime: true, now: 10000});

        config = new Config();
        storageService = await initStorageService();
        clusterService = new ClusterService('mem', {});
        await TunnelConnectionManager.start();
    });

    afterEach(async () => {
        await TunnelConnectionManager.stop();
        await clusterService.destroy();
        await storageService.destroy();
        clock.restore();
        sinon.restore();
    })

    it(`can be learnt`, async () => {
        const tunnelId = crypto.randomBytes(20).toString('hex');
        const nodeId = crypto.randomBytes(20).toString('hex');
        const nodeId2 = crypto.randomBytes(20).toString('hex');

        const connected_at = Date.now();
        await clock.tickAsync(1000);

        TunnelConnectionManager["learnRemoteTunnels"]([
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

        let state = TunnelConnectionManager["connectedTunnels"][tunnelId];
        assert(state.connected == true, "not in connected state");
        assert(state.connected_at == connected_at - 2000, "wrong connected_at timestamp");
        assert(state.connections[0].connected == true, "con-1 not marked as connected");
        assert(state.connections[1].connected == true, "con-2 not marked as connected");
        assert(state.alive_connections == 2, "unexpected number of connections");

        TunnelConnectionManager["learnRemoteTunnels"]([
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

        state = TunnelConnectionManager["connectedTunnels"][tunnelId];
        assert(state.connected == true, "not in connected state");
        assert(state.connected_at == connected_at - 2000, "wrong connected_at timestamp");
        assert(state.connections[0].connected == true, "con-1 not marked as connected");
        assert(state.connections[1].connected == true, "con-2 not marked as connected");
        assert(state.connections[2].connected == true, "con-3 not marked as connected");
        assert(state.alive_connections == 3, "unexpected number of connections");

        const disconnected_at = Date.now();
        TunnelConnectionManager["learnRemoteTunnels"]([
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

        state = TunnelConnectionManager["connectedTunnels"][tunnelId];
        assert(state.connected == true, "not in connected state");
        assert(state.connected_at == connected_at - 2000, "wrong connected_at timestamp");
        assert(state.connections.find((tc) => tc.connection_id == 'con-1')?.connected == false, "con-1 not marked as connected");
        assert(state.connections.find((tc) => tc.connection_id == 'con-2')?.connected == true, "con-2 not marked as connected");
        assert(state.connections.find((tc) => tc.connection_id == 'con-3')?.connected == true, "con-3 not marked as connected");
        assert(state.alive_connections == 2, "unexpected number of connections");

        TunnelConnectionManager["learnRemoteTunnels"]([
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

        TunnelConnectionManager["learnRemoteTunnels"]([
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

        state = TunnelConnectionManager["connectedTunnels"][tunnelId];
        assert(state.connected == false, "in connected state");
        assert(state.connected_at == connected_at - 2000, "wrong connected_at timestamp");
        assert(state.disconnected_at == disconnected_at + 1500, "wrong disconnected_at timestamp");
        assert(state.alive_connections == 0, "unexpected number of connections");
    });

    it(`remote connections are marked as disconnected on timeout`, async () => {
        const tunnelId = crypto.randomBytes(20).toString('hex');
        const nodeId = crypto.randomBytes(20).toString('hex');

        const connected_at = Date.now();
        TunnelConnectionManager["learnRemoteTunnels"]([
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

        let state = TunnelConnectionManager.getConnectedState(tunnelId);
        assert(state?.connected == true, "not in connected state");
        assert(state?.connections[0].connected == true, "con-1 not marked as connected");

        await clock.tickAsync(TunnelConnectionManager["stateRefreshInterval"] + TunnelConnectionManager["tunnelConnectionAliveThreshold"]);
        state = TunnelConnectionManager.getConnectedState(tunnelId);

        assert(state?.connected == false, "in connected state");
        assert(state?.connections[0].connected == false, "con-1 marked as connected");
        assert(state?.alive_connections == 0, "wrong expected number of connections");
    });

    it(`disconnected connections are removed on removal timeout`, async () => {
        const tunnelId = crypto.randomBytes(20).toString('hex');
        const nodeId = crypto.randomBytes(20).toString('hex');

        const connected_at = Date.now();
        TunnelConnectionManager["learnRemoteTunnels"]([
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

        let state = TunnelConnectionManager.getConnectedState(tunnelId);

        assert(state?.connected == true, "not in connected state");
        assert(state?.connections[0].connected == false);
        assert(state?.connections[1].connected == true);
        assert(state?.connections.length == 2);

        await clock.tickAsync(TunnelConnectionManager["tunnelConnectionAliveThreshold"] + TunnelConnectionManager["stateRefreshInterval"]);
        state = TunnelConnectionManager.getConnectedState(tunnelId);
        assert(state?.connected == false, "in connected state");
        assert(state?.connections.length == 2);

        state.connections[0].connected = true;
        state.connections[0].alive_at = Date.now() + TunnelConnectionManager["tunnelConnectionRemoveThreshold"];

        await clock.tickAsync(TunnelConnectionManager["tunnelConnectionRemoveThreshold"] + TunnelConnectionManager["stateRefreshInterval"]);
        state = TunnelConnectionManager.getConnectedState(tunnelId);
        assert(state?.connected == true, "not in connected state");
        assert(state?.connections[0].connected == true);
        assert(state?.connections.length == 1);
    });

    it(`getNextConnection prefers local connections`, async () => {
        const tunnelId = crypto.randomBytes(20).toString('hex');

        TunnelConnectionManager["connectedTunnels"][tunnelId] = {
            connected: true,
            connected_at: Date.now(),
            alive_connections: 2,
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

        let nextCon = TunnelConnectionManager["getNextConnection"](tunnelId);
        assert(nextCon?.connection_id == "con-2", `getNextConnection did not return local connection got ${nextCon}`);

        nextCon = TunnelConnectionManager["getNextConnection"](tunnelId);
        assert(nextCon?.connection_id == "con-2", `getNextConnection did not return local connection got ${nextCon}`);
    });

    it(`getNextConnection round-robins local connections`, async () => {
        const tunnelId = crypto.randomBytes(20).toString('hex');

        TunnelConnectionManager["connectedTunnels"][tunnelId] = {
            connected: true,
            connected_at: Date.now(),
            alive_connections: 2,
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

        let nextCon = TunnelConnectionManager["getNextConnection"](tunnelId);
        assert(nextCon?.connection_id == "con-1", `getNextConnection did not return local connection got ${nextCon}`);

        nextCon = TunnelConnectionManager["getNextConnection"](tunnelId);
        assert(nextCon?.connection_id == "con-2", `getNextConnection did not return local connection got ${nextCon}`);

        nextCon = TunnelConnectionManager["getNextConnection"](tunnelId);
        assert(nextCon?.connection_id == "con-1", `getNextConnection did not return local connection got ${nextCon}`);
    });

    it(`getNextConnection selects remote node if no local connections`, async () => {
        const tunnelId = crypto.randomBytes(20).toString('hex');

        TunnelConnectionManager["connectedTunnels"][tunnelId] = {
            connected: true,
            connected_at: Date.now(),
            alive_connections: 2,
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

        let nextCon = TunnelConnectionManager["getNextConnection"](tunnelId);
        assert(nextCon?.connection_id == "con-1", `getNextConnection did not return connection got ${nextCon}`);
    });

    it(`getNextConnection round-robins remote nodes`, async () => {
        const tunnelId = crypto.randomBytes(20).toString('hex');

        TunnelConnectionManager["connectedTunnels"][tunnelId] = {
            connected: true,
            connected_at: Date.now(),
            alive_connections: 2,
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

        let nextCon = TunnelConnectionManager["getNextConnection"](tunnelId);
        assert(nextCon?.connection_id == "con-1", `getNextConnection did not return connection got ${nextCon}`);

        nextCon = TunnelConnectionManager["getNextConnection"](tunnelId);
        assert(nextCon?.connection_id == "con-2", `getNextConnection did not return connection got ${nextCon}`);

        nextCon = TunnelConnectionManager["getNextConnection"](tunnelId);
        assert(nextCon?.connection_id == "con-1", `getNextConnection did not return connection got ${nextCon}`);
    });

    it(`getNextConnection returns undefined if no connections`, async () => {
        const tunnelId = crypto.randomBytes(20).toString('hex');

        let nextCon = TunnelConnectionManager["getNextConnection"](tunnelId);
        assert(nextCon == undefined, `getNextConnection dit not return undefined`);
    });

    it(`local tunnels are periodically announced`, async () => {
        const bus = new EventBus();

        for (let i = 0; i < TunnelConnectionManager["tunnelAnnounceBatchSize"] * 1.5; i++) {
            const tunnelId = crypto.randomBytes(20).toString('hex');
            const cid = `${tunnelId}-con-1`;

            TunnelConnectionManager["connectedTunnels"][tunnelId] = {
                connected: true,
                connected_at: Date.now(),
                alive_connections: 1,
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

        const expectedAnnouncements = Math.ceil(Object.keys(TunnelConnectionManager["connectedTunnels"]).length / TunnelConnectionManager["tunnelAnnounceBatchSize"]);
        let announcements = 0;
        bus.on('tunnel:announce', (msg) => {
            announcements++;
        });

        await clock.tickAsync(TunnelConnectionManager["tunnelAnnounceInterval"] + 1000);
        assert(announcements == expectedAnnouncements, `expected ${expectedAnnouncements} batch announcements, got ${announcements}`);

        await bus.destroy();
    });
});