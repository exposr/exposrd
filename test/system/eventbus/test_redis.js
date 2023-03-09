import assert from 'assert/strict';
import { setTimeout } from 'timers/promises';
import EventBus, { EventBusService } from '../../../src/eventbus/index.js';
import { REDIS_URL } from '../../env.js';

describe('redis lock', () => {
    let busService;

    before(async () => {

        return new Promise((resolve) => {
            busService = new EventBusService('redis', {
                redisUrl: REDIS_URL,
                callback: (err) => err ? rejects(err) : resolve()
            });
        });
    });

    after(async () => {
        await busService.destroy();
    });

    it('redis bus pub/sub', async () => {
        const bus = new EventBus();

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
        const bus = new EventBus();
        
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
        const bus = new EventBus();

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
        const bus = new EventBus();

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