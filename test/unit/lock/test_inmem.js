import assert from 'assert/strict';
import LockService, { Lock } from '../../../src/lock/index.js';

describe('redis lock', () => {
    let lockService;

    const createLockService = async () => {
        return new Promise((resolve) => {
            const lockService = new LockService('mem', {
                callback: (err) => err ? rejects(err) : resolve(lockService)
            });
        });
    };

    it('memory lock/unlock', async () => {
        const lockService = await createLockService();
        const lock = await lockService.lock("test");
        assert(lock instanceof Lock, `failed to obtain lock, got ${lock}`);

        const islocked = lock.locked()
        assert(islocked == true, `lock is not locked, got ${islocked}`);

        const res = await lock.unlock();
        assert(res == true, `failed to release lock, got ${res}`);
        await lockService.destroy();
    });

    it('memory lock can be pending', async () => {
        const lockService = await createLockService();
        const lock = await lockService.lock("test");
        let lock2 = lockService.lock("test");

        assert(lock.locked() == true, "lock was not locked");
        lock.unlock();
        lock2 = await lock2;
        assert(lock2.locked() == true, "second lock was not locked");

        await lock2.unlock();
        await lockService.destroy();
    });

    it('memory lock can be destroyed with pending locks', async () => {
        const lockService = await createLockService();

        const lock = await lockService.lock("test");
        const lock2 = lockService.lock("test");
        await lockService.destroy();

        const res = await lock2;
        assert(res == false, `expected lock to be unlocked, got ${res}`);
    });
});