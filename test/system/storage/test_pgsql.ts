import assert from 'assert/strict';
import crypto from 'crypto';
import sinon from 'sinon';
import Pgsql from 'pg';
import { setTimeout } from 'timers/promises';
import Config from '../../../src/config.js';
import { Serializable } from '../../../src/storage/serializer.js';
import StorageManager from '../../../src/storage/storage-manager.js';
import Storage, { ListResult } from '../../../src/storage/storage.js';
import PgsqlStorageProvider from '../../../src/storage/pgsql-storage-provider.js';
import { PGSQL_URL } from '../../env.js';

class Data implements Serializable {
    public foo: any;
    public bar: any;
    public obj: any;

    constructor(foo?: any, bar?: any) {
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

describe('pgsql storage', () => {
    let config: Config;
    let clock: sinon.SinonFakeTimers;

    before(async () => {
        config = new Config();
        clock = sinon.useFakeTimers({shouldAdvanceTime: true});
        await StorageManager.init(new URL(PGSQL_URL));
    });

    after(async () => {
        await StorageManager.close();
        await config.destroy();
        clock.restore();
        sinon.restore();
    });

    it('pgsql storage basic set/get', async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        await storage.set(key, {test: 1234});
        const data: any = await storage.get(key);

        assert(data?.test == 1234, `set/get key=${key} got=${data}`);

        await storage.destroy();
    });

    it('pgsql storage basic set/get ns with special characters', async () => {
        const storage = new Storage("test-namespace");
        const key = crypto.randomBytes(20).toString('hex');

        await storage.set(key, {test: 1234});
        const data: any = await storage.get(key);

        assert(data?.test == 1234, `set/get key=${key} got=${data}`);

        await storage.destroy();
    });

    it('pgsql storage key namespace', async () => {
        const storage = new Storage("test");
        const storage2 = new Storage("test2");
        const key = crypto.randomBytes(20).toString('hex');

        await storage.set(key, {test: 1234});
        const data = await storage2.get(key);

        assert(data === null, `${key} visible in ns test2, got ${data}`);

        await storage.destroy();
        await storage2.destroy();
    });

    it('pgsql storage multi key get: all found', async () => {
        const storage = new Storage("test");

        const key1 = crypto.randomBytes(20).toString('hex');
        const key2 = crypto.randomBytes(20).toString('hex');

        await storage.set(key1, {test: 1234});
        await storage.set(key2, {test: 4321});

        const data: any = await storage.get([key1, key2]);

        assert(data[0].test == 1234, `get key=${key1} got=${data[0]}`);
        assert(data[1].test == 4321, `get key=${key2} got=${data[1]}`);

        await storage.destroy();
    });

    it('pgsql storage multi key get: one found', async () => {
        const storage = new Storage("test");

        const key1 = crypto.randomBytes(20).toString('hex');
        const key2 = crypto.randomBytes(20).toString('hex');

        await storage.set(key1, {test: 1234});

        const data: any = await storage.get([key1, key2]);

        assert(data[0].test == 1234, `get key=${key1} got=${data[0]}`);
        assert(data[1] == null, `get key=${key2} got=${data[1]}`);

        await storage.destroy();
    });

    it('pgsql storage multi key get: none found', async () => {
        const storage = new Storage("test");

        const key1 = crypto.randomBytes(20).toString('hex');
        const key2 = crypto.randomBytes(20).toString('hex');

        const data = await storage.get([key1, key2]);

        assert(data[0] == null, `get key=${key1} got=${data[0]}`);
        assert(data[1] == null, `get key=${key2} got=${data[1]}`);

        await storage.destroy();
    });

    it('pgsql storage delete', async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        await storage.set(key, {test: 1234});
        const data: any = await storage.get(key);

        assert(data.test == 1234, `set/get key=${key} got=${data}`);

        const res = await storage.delete(key);
        assert(res == true, `delete returned ${res}`);

        const notfound = await storage.get(key);
        assert(notfound == null, `get returned ${notfound}`);

        await storage.destroy();
    });

    it(`pgsql storage create/read`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let createRes = await storage.create(key, data);
        assert(createRes == true, `unexpected create result, got ${createRes}`);

        const res = await storage.read(key, Data);
        assert(res instanceof Data, `unexpected create result ${res}`);
        assert(res.foo == 1234);
        assert(res.bar == "string");

        await storage.destroy();
    });

    it(`pgsql storage read not found`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const res = await storage.read(key, Data);
        assert(res === null, `unexpected create result ${res}`);

        await storage.destroy();
    });

    it(`pgsql storage create/read complex object`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        data.obj.child.foobar = 42;
        data.obj.list = [
            { asdf: 1 },
            { asdf: 2 }
        ];

        let createRes = await storage.create(key, data);
        assert(createRes == true, `unexpected create result, got ${createRes}`);

        const res = await storage.read(key, Data);
        assert(res instanceof Data, `unexpected create result ${res}`);
        assert(res.foo == 1234);
        assert(res.obj.child.foobar == 42);
        assert(res.obj.list[0].asdf == 1);
        assert(res.obj.list[1].asdf == 2);

        await storage.destroy();
    });

    it(`pgsql storage create`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let createRes = await storage.create(key, data);
        assert(createRes == true, `unexpected create result, got ${createRes}`);

        const res = await storage.create(key, data);
        assert(res == false, `overwrote key same got ${JSON.stringify(res)}`);

        await storage.destroy();
    });

    it(`pgsql storage put`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let res = await storage.put(key, data);
        assert(res == true, `unexpected put result, got ${res}`);

        res = await storage.put(key, data);
        assert(res == true, `unexpected put result, got ${res}`);

        await storage.destroy();
    });

    it(`pgsql storage create/delete`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let createRes = await storage.create(key, data);
        assert(createRes == true, `unexpected create result, got ${createRes}`);

        const deleteRes = await storage.delete(key);
        assert(deleteRes == true, `unexpected delete result ${deleteRes}`);

        let res = await storage.get(key);
        assert(res == null, `unexpected get result ${res}`);

        await storage.destroy();
    });

    it(`pgsql storage update`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let createRes = await storage.create(key, data);
        assert(createRes == true, `unexpected create result, got ${createRes}`);

        let updated = await storage.update(key, Data, async (data) => {
            data.foo = 42;
            return true;
        });
        assert(updated instanceof Data, `unexpected update result ${JSON.stringify(updated)}`);
        assert(updated.foo == 42);

        updated = await storage.update(key, Data, async (data) => {
            data.foo = 43;
            return false;
        });

        let res = await storage.read(key, Data);
        assert(res instanceof Data, `unexpected create result ${res}`);
        assert(res.foo == 42, `got ${JSON.stringify(res)}`);

        await storage.destroy();
    });

    it(`pgsql storage concurrent update`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        const createRes = await storage.create(key, data);
        assert(createRes == true, `unexpected create result, got ${createRes}`);

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
        const res = await storage.read(key, Data);
        assert(res instanceof Data, `unexpected create result ${res}`);
        assert(res.foo == 43, `expected 42, got ${JSON.stringify(res)}`);

        await storage.destroy();
    });

    it(`pgsql storage long-running update`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        const createRes = await storage.create(key, data);
        assert(createRes == true, `unexpected create result, got ${createRes}`);

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

    it(`pgsql storage list`, async () => {
        const keyPrefix = crypto.randomBytes(20).toString('hex');
        const storage = new Storage(keyPrefix);

        const data = new Data(1234, "string")

        for (let index = 0; index < 10; index++) {
            data.foo = index;
            await storage.create(String(index), data);
        }

        let result = 0;
        let res: ListResult | undefined = undefined;
        while (true) {
            res = await storage.list(res, 1);
            assert(res != undefined, "failed to list");
            const keys = res.keys;

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

    it(`pgsql can auto-expire entries`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        const createRes = await storage.create(key, data, 1);
        assert(createRes == true, `unexpected create result, got ${createRes}`);

        await clock.tickAsync(2000);

        const res = await storage.get(key);
        assert(res == null, `storage returned expired entry, got ${res}`);

        await storage.destroy();
    });

    it(`pgsql expired entries are removed from database`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        const createRes = await storage.create(key, data, 1);
        assert(createRes == true, `unexpected create result, got ${createRes}`);

        await clock.tickAsync(2000);

        let res = await storage.get(key);
        assert(res == null, `storage returned expired entry, got ${res}`);

        const sqliteStorage = StorageManager.getStorage() as PgsqlStorageProvider;
        const expiry: number = sqliteStorage["expiryCleanInterval"];

        await clock.tickAsync(expiry * 2);

        const db = new Pgsql.Client({connectionString: PGSQL_URL });
        await db.connect();
        const queryRes = await db.query('SELECT key FROM test WHERE key = $1', [key]);
        assert(queryRes.rowCount == 0, `got ${queryRes.rowCount} rows`);

        await db.end();
        await storage.destroy();
    });
});