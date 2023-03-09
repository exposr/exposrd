import assert from 'assert/strict';
import LockService, { Lock } from '../../../src/lock/index.js';

describe('redis lock', () => {
    let lockService;

    before(async () => {

        return new Promise((resolve) => {
            lockService = new LockService('mem', {
                callback: (err) => err ? rejects(err) : resolve()
            });
        });
    });

    after(async () => {
        await lockService.destroy();
    });

    it('memory lock/unlock', async () => {
        const lock = await lockService.lock("test");
        assert(lock instanceof Lock, `failed to obtain lock, got ${lock}`);

        const islocked = lock.locked()
        assert(islocked == true, `lock is not locked, got ${islocked}`);

        const res = await lock.unlock();
        assert(res == true, `failed to release lock, got ${res}`);
    });

});