import assert from 'assert/strict';
import { setTimeout } from 'timers/promises';
import Config from '../../../src/config.js';
import LockService, { Lock } from '../../../src/lock/index.js';
import { REDIS_URL } from '../../env.js';

describe('redis lock', () => {
    const redisUrl = REDIS_URL;
    let lockService;
    let config;

    before(async () => {
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
    });

    it('redis lock/unlock', async () => {
        const lock = await lockService.lock("test");
        assert(lock instanceof Lock, `failed to obtain lock, got ${lock}`);

        const res = await lock.unlock();
        assert(res == true, `failed to release lock, got ${res}`);
    });

    it('redis lock is extended', async () => {
        const lock = await lockService.lock("test");
        assert(lock instanceof Lock, `failed to obtain lock, got ${lock}`);

        await setTimeout(1100);
        assert(lock.locked() == true, "lock was not locked");

        const res = await lock.unlock();
        assert(res == true, `failed to release lock, got ${res}`);
    });


});