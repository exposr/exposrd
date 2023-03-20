import assert from 'assert/strict';
import sinon from 'sinon';
import dgram from 'dgram';
import ClusterService from "../../../src/cluster/index.js";
import EventBus from "../../../src/cluster/eventbus.js";
import Config from "../../../src/config.js";

describe('UDP eventbus', () => {
    let clusterservice;
    let config;
    let bus;

    beforeEach(() => {
        config = new Config();
        clusterservice = new ClusterService('udp', {});
        bus = new EventBus();
    });

    afterEach(async () => {
        await bus.destroy();
        await clusterservice.destroy();
        config.destroy();
        sinon.restore();
    })

    it('published messages are received', async () => {
        const waitmsg = new Promise((resolve) => {
            bus.once('foo', (msg) => {
                resolve(msg);
            })
        });

        await bus.publish('foo', {data: 42});

        const recv = await waitmsg;
        assert(recv?.data == 42, "did not receive published message");
    });

    it('invalid multicast message is rejected', async () => {
        const spy = sinon.spy(ClusterService.prototype, "_receive");
        const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        sock.send("foo", 1025, '239.0.0.1');

        assert(spy.notCalled, "invalid message was delivered")
        sock.close();
        sinon.restore();
    });

});