import assert from 'assert/strict';
import sinon from 'sinon';
import crypto from 'crypto';
import EventBus from "../../../src/cluster/eventbus.js";
import Config from "../../../src/config.js";
import Node from '../../../src/cluster/cluster-node.js';
import ClusterManager, { ClusterManagerType } from '../../../src/cluster/cluster-manager.js';

describe('cluster service', () => {
    const sendingNode = crypto.createHash('sha1').update(new Date().getTime().toString()).digest('hex');
    let config;
    let clock;

    beforeEach(async () => {
        config = new Config();
        clock = sinon.useFakeTimers({shouldAdvanceTime: true});
        await ClusterManager.init(ClusterManagerType.MEM);
    });

    afterEach(async () => {
        clock.restore();
        await ClusterManager.close();
        config.destroy();
        sinon.restore();
    })

    const publish = async (bus, event, message) => {
        const idStub = sinon.stub(Node, 'identifier').value(sendingNode);
        const ipStub = sinon.stub(Node, 'address').value("127.0.0.127");
        const send = bus.publish(event, message);
        idStub.restore();
        ipStub.restore();
        await send;
    };

    describe('eventbus pub/sub', () => {
        it(`published messages are received`, async () => {
            const bus = new EventBus();

            const waitmsg = new Promise((resolve) => {
                bus.once('foo', (msg) => {
                    resolve(msg);
                })
            });

            await publish(bus, 'foo', {data: 42});
            const recv = await waitmsg;
            assert(recv?.data == 42, "did not receive published message");

            await bus.destroy();
        });

        it(`messages with invalid signatures are rejected`, async () => {
            const spy = sinon.spy(ClusterManager, "receive");
            const bus = new EventBus();

            const recv = bus.waitFor('test', (message) => {
                return message.data == 42;
            }, 100);

            ClusterManager._bus.publish(JSON.stringify({
                event: 'test',
                message: { data: 42 },
                node: {
                    id: "node",
                    host: "hostname",
                    ip: "127.0.0.1"
                },
                ts: new Date().getTime(),
                seq: 0,
                s: "invalid-signature",
            }));

            let res;
            try {
                await recv;
                res = true;
            } catch (e) {
                res = false;
            }
            assert(res == false);
            assert(spy.calledOnce == true, "_receive not called");

            const err = spy.returnValues[0]?.message;
            assert(err == 'invalid message signature: invalid-signature', "_receive did not return signature error");

            sinon.restore();
            await bus.destroy();
        });

        it(`receive window wraps around, then out-of-order`, async () => {
            const bus = new EventBus();

            const waitmsg = () => {
                return new Promise((resolve) => {
                    bus.once('foo', (msg) => {
                        resolve(msg);
                    })
                });
            };

            let recv;
            for (let i = 0; i < (ClusterManager._window_size * 2) + 3; i++) {
                recv = waitmsg();
                await publish(bus, 'foo', {data: 42});
                assert((await recv)?.data == 42, "did not receive published message");
            }

            let prev_seq = ClusterManager._seq;
            ClusterManager._seq += 2; 
            await publish(bus, 'foo', {data: 42});
            assert((await recv)?.data == 42, "did not receive published message");
            assert(ClusterManager._nodes[sendingNode].seq_win.toString(2) == '1111111111111001',
                `got ${ClusterManager._nodes[sendingNode].seq_win.toString(2)}`);

            ClusterManager._seq = prev_seq; 
            await publish(bus, 'foo', {data: 42});
            assert((await recv)?.data == 42, "did not receive published message");
            assert(ClusterManager._nodes[sendingNode].seq_win.toString(2) == '1111111111111101',
                `got ${ClusterManager._nodes[sendingNode].seq_win.toString(2)}`);

            await bus.destroy();
        });

        it(`out-of-order messages are accepted`, async () => {
            const bus = new EventBus();

            const waitmsg = () => {
                return new Promise((resolve) => {
                    bus.once('foo', (msg) => {
                        resolve(msg);
                    })
                });
            };

            ClusterManager._seq = 2;
            let recv = waitmsg();
            await publish(bus, 'foo', {data: 42});
            assert((await recv)?.data == 42, "did not receive published message");
            assert(ClusterManager._nodes[sendingNode].seq_win.toString(2) == '1',
                `got ${ClusterManager._nodes[sendingNode].seq_win.toString(2)}`);

            ClusterManager._seq = 0;
            recv = waitmsg();
            await publish(bus, 'foo', {data: 43});
            assert((await recv)?.data == 43, "did not receive published message");
            assert(ClusterManager._nodes[sendingNode].seq_win.toString(2) == '101',
                `got ${ClusterManager._nodes[sendingNode].seq_win.toString(2)}`);

            ClusterManager._seq = 1;
            recv = waitmsg();
            await publish(bus, 'foo', {data: 44});
            assert((await recv)?.data == 44, "did not receive published message");
            assert(ClusterManager._nodes[sendingNode].seq_win.toString(2) == '111',
                `got ${ClusterManager._nodes[sendingNode].seq_win.toString(2)}`);

            await bus.destroy();
        });

        it(`repeated messages are rejected`, async () => {
            const spy = sinon.spy(ClusterManager, "receive");
            const bus = new EventBus();

            const waitmsg = () => {
                return new Promise((resolve) => {
                    bus.once('foo', (msg) => {
                        resolve(msg);
                    })
                });
            };

            let recv = waitmsg();
            await publish(bus, 'foo', {data: 42});
            assert((await recv)?.data == 42, "did not receive published message");

            recv = waitmsg();
            await publish(bus, 'foo', {data: 42});
            assert((await recv)?.data == 42, "did not receive published message");

            ClusterManager._seq = 1;
            recv = bus.waitFor('test', (message) => {
                return message.data == 43;
            }, 100);
            await publish(bus, 'foo', {data: 43});
            await recv.catch(() => {});

            const err = spy.returnValues[2]?.message;
            assert(err == 'message 1 already received, window=1', `got ${err}`);

            spy.restore();
            await bus.destroy();
        });
    });

    describe('cluster nodes', () => {
        it(`are learned when messages are received`, async () => {
            const spy = sinon.spy(ClusterManager, "_learnNode");
            const bus = new EventBus();

            await publish(bus, 'foo', {data: 42});

            assert(spy.calledOnce == true, "_learnNode not called");

            const node = ClusterManager.getNode(sendingNode);
            assert(node?.id == sendingNode, "node not learnt");
            assert(ClusterManager._nodes[sendingNode].stale == false, "node marked as stale");
            sinon.restore();
            await bus.destroy();
        });

        it(`are marked stale after stale timeout`, async () => {
            const spy = sinon.spy(ClusterManager, "_staleNode");
            const bus = new EventBus();

            await publish(bus, 'foo', {data: 42});

            let node = ClusterManager.getNode(sendingNode);
            assert(node?.id == sendingNode, "node not learnt");

            await clock.tickAsync(ClusterManager._staleTimeout + 1);

            assert(spy.calledOnce == true, "_staleNode not called");

            node = ClusterManager.getNode(sendingNode)
            assert(node == undefined, "getNode returned stale node");

            node = ClusterManager._nodes[sendingNode]
            assert(ClusterManager._nodes[sendingNode].stale == true, "node marked as stale");

            await bus.destroy();
        });

        it(`are not marked stale when heartbeat is received`, async () => {
            const spy = sinon.spy(ClusterManager, "_staleNode");
            const bus = new EventBus();

            await publish(bus, 'cluster:heartbeat', {});

            let node = ClusterManager.getNode(sendingNode);
            assert(node?.id == sendingNode, "node not learnt");

            await clock.tickAsync(ClusterManager._staleTimeout / 2);
            await publish(bus, 'cluster:heartbeat', {});

            await clock.tickAsync((ClusterManager._staleTimeout / 2) + 1);

            assert(spy.calledOnce == false, "_staleNode called");
            await bus.destroy();
        });

        it(`are deleted after removal timeout`, async () => {
            const spy = sinon.spy(ClusterManager, "_forgetNode");
            const bus = new EventBus();

            await publish(bus, 'foo', {data: 42});

            let node = ClusterManager.getNode(sendingNode);
            assert(node?.id == sendingNode, "node not learnt");

            await clock.tickAsync(ClusterManager._removalTimeout + 1);

            assert(spy.calledOnce == true, "_forgetNode not called");

            node = ClusterManager.getNode(sendingNode)
            assert(node == undefined, "getNode returned node, should be deleted");

            node = ClusterManager._nodes[sendingNode]
            assert(node == undefined, "node not removed");

            await bus.destroy();
        });

        it(`are sending heartbeat`, async () => {
            const spy = sinon.spy(ClusterManager, "publish");

            // Heartbeat sent on start
            await ClusterManager.start();
            assert(spy.calledOnceWithExactly("cluster:heartbeat"), "initial start heartbeat not sent");

            // Heartbeat sent after interval
            await clock.tickAsync(ClusterManager._heartbeatInterval + 1);
            assert(spy.getCall(1)?.calledWithExactly("cluster:heartbeat"), "heartbeat not sent");

            await clock.tickAsync(ClusterManager._heartbeatInterval + 1);
            assert(spy.getCall(2)?.calledWithExactly("cluster:heartbeat"), "heartbeat not sent");

            sinon.restore();
        });

        it(`are returned by _getLearntPeers`, async () => {
            const bus = new EventBus();
            await publish(bus, 'foo', {data: 42});

            const nodes = ClusterManager.getLearntPeers();
            assert(nodes.length == 2, "unexpected numbers of peers");

            await bus.destroy();
        });

        it(`are not returned by _getLearntPeers if stale`, async () => {
            const spy = sinon.spy(ClusterManager, "_staleNode");
            const bus = new EventBus();

            await publish(bus, 'foo', {data: 42});

            let node = ClusterManager.getNode(sendingNode);
            assert(node?.id == sendingNode, "node not learnt");

            await clock.tickAsync(ClusterManager._staleTimeout + 1);

            const nodes = ClusterManager.getLearntPeers();
            assert(nodes.length == 1, "unexpected numbers of peers");

            await bus.destroy();
        });

    });

});