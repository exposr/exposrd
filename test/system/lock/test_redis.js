import assert from 'assert/strict';
import { setTimeout } from 'timers/promises';
import Config from '../../../src/config.js';
import LockService, { Lock } from '../../../src/lock/index.js';
import { REDIS_URL } from '../../env.js';
import sinon from 'sinon';

describe('redis lock', () => {
    const redisUrl = REDIS_URL;
    let lockService;
    let config;
    let clock;

    before(async () => {
        clock = sinon.useFakeTimers({shouldAdvanceTime: true});
        config = new Config();
        return new Promise((resolve) => {
            lockService = new LockService('redis', {
                redisUrl,
                callback: (err) => err ? rejects(err) : resolve()
            });
        });
    });

    after(async () => {
        await lockService.destroy();
        await config.destroy();
        clock.restore();
    });

    it('redis lock can be lock and unlocked', async () => {
        const lock = await lockService.lock("test");
        assert(lock instanceof Lock, `failed to obtain lock, got ${lock}`);

        const res = await lock.unlock();
        assert(res == true, `failed to release lock, got ${res}`);
    });

    it('redis lock is extended', async () => {
        const lock = await lockService.lock("test");
        assert(lock instanceof Lock, `failed to obtain lock, got ${lock}`);

        assert(lock.locked() == true, "lock was not locked");
        await clock.tickAsync(2000);
        assert(lock.locked() == true, "lock was not extended");

        const res = await lock.unlock();
        assert(res == true, `failed to release lock, got ${res}`);
    });

    it('redis lock can be pending', async () => {
        const lock = await lockService.lock("test");
        let lock2 = lockService.lock("test");

        assert(lock.locked() == true, "lock was not locked");
        lock.unlock();
        lock2 = await lock2;
        assert(lock2.locked() == true, "second lock was not locked");

        await lock2.unlock();
    });


});