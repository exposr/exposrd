import assert from 'assert/strict';
import sinon from 'sinon';
import crypto from 'crypto';
import ClusterService from "../../../src/cluster/index.js";
import EventBus from "../../../src/cluster/eventbus.js";
import Config from "../../../src/config.js";
import Node from '../../../src/cluster/cluster-node.js';

describe('cluster service', () => {
    const sendingNode = crypto.createHash('sha1').update(new Date().getTime().toString()).digest('hex');
    let clusterservice;
    let config;
    let clock;

    beforeEach(() => {
        config = new Config();
        clock = sinon.useFakeTimers({shouldAdvanceTime: true});
        clusterservice = new ClusterService('mem', {});
    });

    afterEach(async () => {
        clock.restore();
        await clusterservice.destroy();
        config.destroy();
        sinon.restore();
    })

    const publish = async (bus, event, message) => {
        const stub = sinon.stub(Node, 'identifier').value(sendingNode);
        const send = bus.publish(event, message);
        stub.restore();
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
            const spy = sinon.spy(ClusterService.prototype, "_receive");
            const bus = new EventBus();

            const recv = bus.waitFor('test', (message) => {
                return message.data == 42;
            }, 100);

            clusterservice._bus.publish(JSON.stringify({
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
            for (let i = 0; i < (clusterservice._window_size * 2) + 3; i++) {
                recv = waitmsg();
                await publish(bus, 'foo', {data: 42});
                assert((await recv)?.data == 42, "did not receive published message");
            }

            let prev_seq = clusterservice._seq;
            clusterservice._seq += 2; 
            await publish(bus, 'foo', {data: 42});
            assert((await recv)?.data == 42, "did not receive published message");
            assert(clusterservice._nodes[sendingNode].seq_win.toString(2) == '1111111111111001',
                `got ${clusterservice._nodes[sendingNode].seq_win.toString(2)}`);

            clusterservice._seq = prev_seq; 
            await publish(bus, 'foo', {data: 42});
            assert((await recv)?.data == 42, "did not receive published message");
            assert(clusterservice._nodes[sendingNode].seq_win.toString(2) == '1111111111111101',
                `got ${clusterservice._nodes[sendingNode].seq_win.toString(2)}`);

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

            clusterservice._seq = 2;
            let recv = waitmsg();
            await publish(bus, 'foo', {data: 42});
            assert((await recv)?.data == 42, "did not receive published message");
            assert(clusterservice._nodes[sendingNode].seq_win.toString(2) == '1',
                `got ${clusterservice._nodes[sendingNode].seq_win.toString(2)}`);

            clusterservice._seq = 0;
            recv = waitmsg();
            await publish(bus, 'foo', {data: 43});
            assert((await recv)?.data == 43, "did not receive published message");
            assert(clusterservice._nodes[sendingNode].seq_win.toString(2) == '101',
                `got ${clusterservice._nodes[sendingNode].seq_win.toString(2)}`);

            clusterservice._seq = 1;
            recv = waitmsg();
            await publish(bus, 'foo', {data: 44});
            assert((await recv)?.data == 44, "did not receive published message");
            assert(clusterservice._nodes[sendingNode].seq_win.toString(2) == '111',
                `got ${clusterservice._nodes[sendingNode].seq_win.toString(2)}`);

            await bus.destroy();
        });

        it(`repeated messages are rejected`, async () => {
            const spy = sinon.spy(ClusterService.prototype, "_receive");
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

            clusterservice._seq = 1;
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
            const spy = sinon.spy(ClusterService.prototype, "_learnNode");
            const bus = new EventBus();

            await publish(bus, 'foo', {data: 42});

            assert(spy.calledOnce == true, "_learnNode not called");

            const node = clusterservice.getNode(sendingNode);
            assert(node?.id == sendingNode, "node not learnt");
            assert(clusterservice._nodes[sendingNode].stale == false, "node marked as stale");
            sinon.restore();
            await bus.destroy();
        });

        it(`are marked stale after stale timeout`, async () => {
            const spy = sinon.spy(ClusterService.prototype, "_staleNode");
            const bus = new EventBus();

            await publish(bus, 'foo', {data: 42});

            let node = clusterservice.getNode(sendingNode);
            assert(node?.id == sendingNode, "node not learnt");

            await clock.tickAsync(clusterservice._staleTimeout + 1);

            assert(spy.calledOnce == true, "_staleNode not called");

            node = clusterservice.getNode(sendingNode)
            assert(node == undefined, "getNode returned stale node");

            node = clusterservice._nodes[sendingNode]
            assert(clusterservice._nodes[sendingNode].stale == true, "node marked as stale");

            await bus.destroy();
        });

        it(`are deleted after removal timeout`, async () => {
            const spy = sinon.spy(ClusterService.prototype, "_forgetNode");
            const bus = new EventBus();

            await publish(bus, 'foo', {data: 42});

            let node = clusterservice.getNode(sendingNode);
            assert(node?.id == sendingNode, "node not learnt");

            await clock.tickAsync(clusterservice._removalTimeout + 1);

            assert(spy.calledOnce == true, "_forgetNode not called");

            node = clusterservice.getNode(sendingNode)
            assert(node == undefined, "getNode returned node, should be deleted");

            node = clusterservice._nodes[sendingNode]
            assert(node == undefined, "node not removed");

            await bus.destroy();
        });

        it(`are sending heartbeat`, async () => {
            const spy = sinon.spy(ClusterService.prototype, "publish");

            // Heartbeat sent on ready
            clusterservice.setReady();
            assert(spy.calledOnceWithExactly("cluster:heartbeat"), "initial onready heartbeat not sent");

            // Heartbeat sent after interval
            await clock.tickAsync(clusterservice._heartbeatInterval + 1);
            assert(spy.getCall(1)?.calledWithExactly("cluster:heartbeat"), "heartbeat not sent");

            await clock.tickAsync(clusterservice._heartbeatInterval + 1);
            assert(spy.getCall(2)?.calledWithExactly("cluster:heartbeat"), "heartbeat not sent");

            sinon.restore();
        });
    });

});