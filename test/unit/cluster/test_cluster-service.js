import assert from 'assert/strict';
import sinon from 'sinon';
import crypto from 'crypto';
import ClusterService from "../../../src/cluster/index.js";
import EventBus from "../../../src/cluster/eventbus.js";
import Config from "../../../src/config.js";
import Node from '../../../src/cluster/cluster-node.js';

describe('cluster service', () => {
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
    })

    describe('eventbus pub/sub', () => {
        it(`published messages are received`, async () => {
            const bus = new EventBus();

            const waitmsg = new Promise((resolve) => {
                bus.once('foo', (msg) => {
                    resolve(msg);
                })
            });

            await bus.publish('foo', {data: 42});
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
    });

    describe('cluster nodes', () => {
        it(`are learned when messages are received`, async () => {
            const spy = sinon.spy(ClusterService.prototype, "_learnNode");
            const bus = new EventBus();

            const nodeId = crypto.createHash('sha1').update(new Date().getTime().toString()).digest('hex');
            const stub = sinon.stub(Node, 'identifier').value(nodeId);

            let res = bus.publish('foo', {data: 42});
            stub.restore();
            await res;

            assert(spy.calledOnce == true, "_learnNode not called");

            const node = clusterservice.getNode(nodeId);
            assert(node?.id == nodeId, "node not learnt");
            assert(node?.stale == false, "node marked as stale");
            sinon.restore();
            await bus.destroy();
        });

        it(`are marked stale after stale timeout`, async () => {
            const spy = sinon.spy(ClusterService.prototype, "_staleNode");
            const bus = new EventBus();

            const nodeId = crypto.createHash('sha1').update(new Date().getTime().toString()).digest('hex');
            const stub = sinon.stub(Node, 'identifier').value(nodeId);

            let res = bus.publish('foo', {data: 42});
            stub.restore();
            await res;

            let node = clusterservice.getNode(nodeId);
            assert(node?.id == nodeId, "node not learnt");

            await clock.tickAsync(clusterservice._staleTimeout + 1);

            assert(spy.calledOnce == true, "_staleNode not called");

            node = clusterservice.getNode(nodeId)
            assert(node == undefined, "getNode returned stale node");

            node = clusterservice._nodes[nodeId]
            assert(node?.stale == true, "node not marked as stale");

            sinon.restore();
            await bus.destroy();
        });

        it(`are deleted after removal timeout`, async () => {
            const spy = sinon.spy(ClusterService.prototype, "_forgetNode");
            const bus = new EventBus();

            const nodeId = crypto.createHash('sha1').update(new Date().getTime().toString()).digest('hex');
            const stub = sinon.stub(Node, 'identifier').value(nodeId);

            let res = bus.publish('foo', {data: 42});
            stub.restore();
            await res;

            let node = clusterservice.getNode(nodeId);
            assert(node?.id == nodeId, "node not learnt");

            await clock.tickAsync(clusterservice._removalTimeout + 1);

            assert(spy.calledOnce == true, "_forgetNode not called");

            node = clusterservice.getNode(nodeId)
            assert(node == undefined, "getNode returned node, should be deleted");

            node = clusterservice._nodes[nodeId]
            assert(node == undefined, "node not removed");

            sinon.restore();
            await bus.destroy();
        });

        it(`are sending heartbeat`, async () => {
            const spy = sinon.spy(ClusterService.prototype, "publish");

            await clock.tickAsync(clusterservice._heartbeatInterval + 1);

            assert(spy.calledOnceWithExactly("cluster:heartbeat"), "heartbeat not sent");

            sinon.restore();
        });
    });

});