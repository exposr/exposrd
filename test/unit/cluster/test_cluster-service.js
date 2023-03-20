import assert from 'assert/strict';
import ClusterService from "../../../src/cluster/index.js";
import EventBus from "../../../src/cluster/eventbus.js";
import Config from "../../../src/config.js";

describe('cluster service', () => {
    let clusterservice;
    let config;

    beforeEach(() => {
        config = new Config();
        clusterservice = new ClusterService('mem', {});
    });

    afterEach(async () => {
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

            await bus.destroy();
        });
    });
});