import assert from 'assert/strict';
import Config from '../../../src/config.js';
import ClusterService from '../../../src/cluster/index.js';
import EventBus from '../../../src/cluster/eventbus.js';
import { REDIS_URL } from '../../env.js';

describe('redis eventbus', () => {
    let clusterService;
    let bus;
    let config;

    before(async () => {
        config = new Config();
        return new Promise((resolve) => {
            clusterService = new ClusterService('redis', {
                redis: {
                    redisUrl: REDIS_URL,
                },
                callback: (err) => err ? rejects(err) : resolve()
            });
        });
    });

    after(async () => {
        await clusterService.destroy();
        await config.destroy();
    });

    beforeEach(() => {
        bus = new EventBus();
    });

    afterEach(async () => {
        await bus.destroy();
    });

    it('redis bus pub/sub', async () => {
        const recv = new Promise((resolve) => {
            bus.once('test', (message) => {
                resolve(message)
            });
        });

        await bus.publish('test2', {data: 10});
        let res = await bus.publish('test', {data: 42});
        assert(res == true, `failed to publish message, got ${res}`);

        res = await recv;
        assert(res.data == 42);
    });

    it('redis bus waitfor', async () => {
        const recv = bus.waitFor('test', (message) => {
            return message.data == 42;
        });

        let res = await bus.publish('test', {data: 42});
        
        assert(res == true, `failed to publish message, got ${res}`);

        res = await recv;
        assert(res.data == 42);
        assert(bus.listenerCount('test') == 0, 'listener still attached');
    });

    it('redis bus waitfor timeout wrong data', async () => {
        const recv = bus.waitFor('test', (message) => {
            return message.data == 42;
        }, 100);

        let res = await bus.publish('test', {data: 10});
        assert(res == true, `failed to publish message, got ${res}`);

        try {
            await recv;
            res = true;
        } catch (e) {
            res = false;
        }
        assert(res == false);
        assert(bus.listenerCount('test') == 0, 'listener still attached');
    });

    it('redis bus waitfor timeout no data', async () => {
        const recv = bus.waitFor('test', (message) => {
            return message.data == 42;
        }, 100);

        let res;
        try {
            await recv;
            res = true;
        } catch (e) {
            res = false;
        }
        assert(res == false);
        assert(bus.listenerCount('test') == 0, 'listener still attached');
    });

});