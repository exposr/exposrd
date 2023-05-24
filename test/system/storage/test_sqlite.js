import assert from 'assert/strict';
import sinon from 'sinon';
import crypto from 'crypto';
import Storage, { StorageService } from '../../../src/storage/index.js';
import { setTimeout } from 'timers/promises';
import Config from '../../../src/config.js';
import { rm } from 'fs/promises';
import Sqlite from 'better-sqlite3';

class Data {
    constructor(foo, bar) {
        this.foo = foo;
        this.bar = bar;
        this.obj = {
            child: {
                foobar: undefined
            },
            list: []
        }
    }
}

describe('sqlite storage', () => {
    const sqlitedb = "testdb.sqlite";
    let storageService;
    let config;
    let clock;

    before(async () => {
        config = new Config();
        clock = sinon.useFakeTimers({shouldAdvanceTime: true});
        await new Promise((resolve, reject) => {
            storageService = new StorageService({
                url: new URL(`sqlite://${sqlitedb}`),
                callback: (err) => err ? reject(err) : resolve()
            });
        });
    });

    after(async () => {
        await storageService.destroy();
        await config.destroy();
        await rm(sqlitedb);
        clock.restore();
        sinon.restore();
    });

    it('sqlite storage basic set/get', async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        await storage.set(key, {test: 1234});
        const data = await storage.get(key);

        assert(data?.test == 1234, `set/get key=${key} got=${data}`);

        await storage.destroy();
    });

    it('sqlite storage basic set/get ns with special characters', async () => {
        const storage = new Storage("test-namespace");
        const key = crypto.randomBytes(20).toString('hex');

        await storage.set(key, {test: 1234});
        const data = await storage.get(key);

        assert(data?.test == 1234, `set/get key=${key} got=${data}`);

        await storage.destroy();
    });

    it('sqlite storage key namespace', async () => {
        const storage = new Storage("test");
        const storage2 = new Storage("test2");
        const key = crypto.randomBytes(20).toString('hex');

        await storage.set(key, {test: 1234});
        const data = await storage2.get(key);

        assert(data === null, `${key} visible in ns test2, got ${data}`);

        await storage.destroy();
        await storage2.destroy();
    });

    it('sqlite storage multi key get: all found', async () => {
        const storage = new Storage("test");

        const key1 = crypto.randomBytes(20).toString('hex');
        const key2 = crypto.randomBytes(20).toString('hex');

        await storage.set(key1, {test: 1234});
        await storage.set(key2, {test: 4321});

        const data = await storage.get([key1, key2]);

        assert(data[0].test == 1234, `get key=${key1} got=${data[0]}`);
        assert(data[1].test == 4321, `get key=${key2} got=${data[1]}`);

        await storage.destroy();
    });

    it('sqlite storage multi key get: one found', async () => {
        const storage = new Storage("test");

        const key1 = crypto.randomBytes(20).toString('hex');
        const key2 = crypto.randomBytes(20).toString('hex');

        await storage.set(key1, {test: 1234});

        const data = await storage.get([key1, key2]);

        assert(data[0].test == 1234, `get key=${key1} got=${data[0]}`);
        assert(data[1] == null, `get key=${key2} got=${data[1]}`);

        await storage.destroy();
    });

    it('sqlite storage multi key get: none found', async () => {
        const storage = new Storage("test");

        const key1 = crypto.randomBytes(20).toString('hex');
        const key2 = crypto.randomBytes(20).toString('hex');

        const data = await storage.get([key1, key2]);

        assert(data[0] == null, `get key=${key1} got=${data[0]}`);
        assert(data[1] == null, `get key=${key2} got=${data[1]}`);

        await storage.destroy();
    });

    it('sqlite storage delete', async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        await storage.set(key, {test: 1234});
        const data = await storage.get(key);

        assert(data.test == 1234, `set/get key=${key} got=${data}`);

        const res = await storage.delete(key);
        assert(res == true, `delete returned ${res}`);

        const notfound = await storage.get(key);
        assert(notfound == null, `get returned ${notfound}`);

        await storage.destroy();
    });

    it(`sqlite storage create/read`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let res = await storage.create(key, data);

        assert(res instanceof Data, `unexpected create result ${res}`);
        assert(res.foo == 1234),
        assert(res.bar == "string"),

        res = await storage.read(key, Data);
        assert(res instanceof Data, `unexpected create result ${res}`);
        assert(res.foo == 1234);
        assert(res.bar == "string");

        await storage.destroy();
    });

    it(`sqlite storage read not found`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const res = await storage.read(key, Data);
        assert(res === null, `unexpected create result ${res}`);

        await storage.destroy();
    });

    it(`sqlite storage create/read complex object`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        data.obj.child.foobar = 42;
        data.obj.list = [
            { asdf: 1 },
            { asdf: 2 }
        ]
        let res = await storage.create(key, data);
        assert(res instanceof Data, `unexpected create result ${res}`);

        res = await storage.read(key, Data);
        assert(res instanceof Data, `unexpected create result ${res}`);
        assert(res.foo == 1234);
        assert(res.obj.child.foobar == 42);
        assert(res.obj.list[0].asdf == 1);
        assert(res.obj.list[1].asdf == 2);

        await storage.destroy();
    });

    it(`sqlite storage create exclusive`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let res = await storage.create(key, data, {NX: true});
        assert(res instanceof Data, `unexpected create result ${res}`);

        res = await storage.create(key, data, {NX: true});
        assert(res == false, `overwrote key same got ${JSON.stringify(res)}`);

        await storage.destroy();
    });

    it(`sqlite storage create non-exclusive`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let res = await storage.create(key, data, {NX: false});
        assert(res instanceof Data, `unexpected create result ${res}`);

        res = await storage.create(key, data, {NX: false});
        assert(res instanceof Data, `unexpected create result ${res}`);

        await storage.destroy();
    });

    it(`sqlite storage create/delete`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let res = await storage.create(key, data);
        assert(res instanceof Data, `unexpected create result ${res}`);

        res = await storage.delete(key);
        assert(res === true, `unexpected delete result ${res}`);

        res = await storage.get(key);
        assert(res == null, `unexpected get result ${res}`);

        await storage.destroy();
    });

    it(`sqlite storage update`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let res = await storage.create(key, data);
        assert(res instanceof Data, `unexpected create result ${res}`);

        let updated = await storage.update(key, Data, (data) => {
            data.foo = 42;
            return true;
        });
        assert(updated instanceof Data, `unexpected update result ${JSON.stringify(updated)}`);
        assert(updated.foo == 42);

        updated = await storage.update(key, Data, (data) => {
            data.foo = 43;
            return false;
        });

        res = await storage.read(key, Data);
        assert(res.foo == 42, `got ${JSON.stringify(res)}`);

        await storage.destroy();
    });

    it(`sqlite storage concurrent update`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let res = await storage.create(key, data);
        assert(res instanceof Data, `unexpected create result ${res}`);

        const update1 = storage.update(key, Data, async (data) => {
            await setTimeout(1000);
            assert(data.foo == 1234);
            data.foo = 42;
            return true;
        });

        await setTimeout(250);
        const update2 = storage.update(key, Data, async (data) => {
            assert(data.foo == 42);
            data.foo++;
            return true;
        });

        await Promise.all([update1, update2]);
        res = await storage.read(key, Data);
        assert(res.foo == 43, `expected 42, got ${JSON.stringify(res)}`);

        await storage.destroy();
    });

    it(`sqlite storage long-running update`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let res = await storage.create(key, data);
        assert(res instanceof Data, `unexpected create result ${res}`);

        const update = await storage.update(key, Data, async (data) => {
            await setTimeout(1200);
            assert(data.foo == 1234);
            data.foo = 42;
            return true;
        });

        assert(update instanceof Data, `long running update failed, got ${update}`);
        assert(update.foo == 42, `data was not updated, got ${JSON.stringify(update)}`);

        await storage.destroy();
    });

    it(`sqlite storage list`, async () => {
        const keyPrefix = crypto.randomBytes(20).toString('hex');
        const storage = new Storage(keyPrefix);

        const data = new Data(1234, "string")

        for (let index = 0; index < 10; index++) {
            data.foo = index;
            await storage.create(index, data);
        }

        let result = 0;
        let res;
        while (true) {
            res = await storage.list(res, 1);
            assert(res != undefined, "failed to list");
            const keys = res.data;

            if (keys.length > 0) {
                assert(keys.length == 1, `expected one entry, got ${keys.length}, ${JSON.stringify(res)}`);
                result += keys.length;
            }

            if (res.cursor == null) {
                break;
            }
        }

        assert(result == 10, `unexpected number of results, got ${result}`);
        await storage.destroy();
    });

    it(`sqlite can auto-expire entries`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let res = await storage.create(key, data, {TTL: 1});
        assert(res instanceof Data, `unexpected create result ${res}`);

        await clock.tickAsync(2000);

        res = await storage.get(key);
        assert(res == null, `storage returned expired entry, got ${res}`);

        await storage.destroy();
    });

    it(`sqlite expired entries are removed from database`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let res = await storage.create(key, data, {TTL: 1});
        assert(res instanceof Data, `unexpected create result ${res}`);

        await clock.tickAsync(2000);

        res = await storage.get(key);
        assert(res == null, `storage returned expired entry, got ${res}`);

        await clock.tickAsync(storage._storage.expiryCleanInterval + 1000);

        const db = new Sqlite(sqlitedb, { readonly: true });
        const stm = db.prepare(`SELECT key FROM test WHERE key = ?`);
        res = stm.get(key);
        assert(res == undefined);

        db.close();
        await storage.destroy();
    });

});