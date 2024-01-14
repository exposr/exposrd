import assert from 'assert/strict';
import crypto from 'crypto';
import Config from '../../../src/config.js';
import { setTimeout } from 'timers/promises';
import StorageManager from '../../../src/storage/storage-manager.js';
import Storage, { ListResult } from '../../../src/storage/storage.js';
import { Serializable } from '../../../src/storage/serializer.js';

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

describe('storage service', () => {
    let config: any;

    before(async () => {
        config = new Config();
        StorageManager.init(new URL('memory://'));
    });

    after(async () => {
        StorageManager.close();
        await config.destroy();
    });

    it('basic set/get', async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        await storage.set(key, {test: 1234});
        const data: any = await storage.get(key);

        assert(data.test == 1234, `set/get key=${key} got=${data}`);

        await storage.destroy();
    });

    it('storage key namespace', async () => {
        const storage = new Storage("test");
        const storage2 = new Storage("test2");
        const key = crypto.randomBytes(20).toString('hex');

        await storage.set(key, {test: 1234});
        const data = await storage2.get(key);

        assert(data === null, `${key} visible in ns test2, got ${data}`);

        await storage.destroy();
        await storage2.destroy();
    });

    it('storage multi key get: all found', async () => {
        const storage = new Storage("test");

        const key1 = crypto.randomBytes(20).toString('hex');
        const key2 = crypto.randomBytes(20).toString('hex');

        await storage.set(key1, {test: 1234});
        await storage.set(key2, {test: 4321});

        const data: Array<any>  = await storage.get([key1, key2]);

        assert(data[0].test == 1234, `get key=${key1} got=${data[0]}`);
        assert(data[1].test == 4321, `get key=${key2} got=${data[1]}`);

        await storage.destroy();
    });

    it('storage multi key get: one found', async () => {
        const storage = new Storage("test");

        const key1 = crypto.randomBytes(20).toString('hex');
        const key2 = crypto.randomBytes(20).toString('hex');

        await storage.set(key1, {test: 1234});

        const data: Array<any> = await storage.get([key1, key2]);

        assert(data[0].test == 1234, `get key=${key1} got=${data[0]}`);
        assert(data[1] == null, `get key=${key2} got=${data[1]}`);

        await storage.destroy();
    });

    it('storage multi key get: none found', async () => {
        const storage = new Storage("test");

        const key1 = crypto.randomBytes(20).toString('hex');
        const key2 = crypto.randomBytes(20).toString('hex');

        const data = await storage.get([key1, key2]);

        assert(data[0] == null, `get key=${key1} got=${data[0]}`);
        assert(data[1] == null, `get key=${key2} got=${data[1]}`);

        await storage.destroy();
    });

    it('storage delete', async () => {
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

    it(`storage create/read`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        const res = await storage.create(key, data);
        assert(res == true, "create failed");

        const readData = await storage.read<Data>(key, Data);
        assert(readData instanceof Data, `unexpected create result ${readData}}`);
        assert(readData.foo == 1234);
        assert(readData.bar == "string");

        await storage.destroy();
    });

    it(`storage read not found`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const res = await storage.read<Data>(key, Data);
        assert(res === null, `unexpected create result ${res}`);

        await storage.destroy();
    });

    it(`storage create/read complex object`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string");
        data.obj.child.foobar = 42;
        data.obj.list = [
            { asdf: 1 },
            { asdf: 2 }
        ];

        let createRes = await storage.create(key, data);
        assert(createRes == true, "create failed");

        let res = await storage.read<Data>(key, Data);
        assert(res instanceof Data, `unexpected create result ${res}`);
        assert(res.foo == 1234);
        assert(res.obj.child.foobar == 42);
        assert(res.obj.list[0].asdf == 1);
        assert(res.obj.list[1].asdf == 2);

        await storage.destroy();
    });

    it(`storage create exclusive`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let res = await storage.create(key, data);
        assert(res == true, `unexpected create result ${res}`);

        res = await storage.create(key, data);
        assert(res == false, `overwrote key same got ${JSON.stringify(res)}`);

        await storage.destroy();
    });

    it(`storage put`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let res = await storage.put(key, data);
        assert(res == true, `unexpected put result, got ${res}`);

        res = await storage.put(key, data);
        assert(res == true, `unexpected put result, got ${res}`);

        await storage.destroy();
    });

    it(`storage create/delete`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let res = await storage.create(key, data);
        assert(res === true, `unexpected create result ${res}`);

        res = await storage.delete(key);
        assert(res === true, `unexpected delete result ${res}`);

        const getRes = await storage.get(key);
        assert(getRes == null, `unexpected get result ${res}`);

        await storage.destroy();
    });

    it(`storage update`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let res = await storage.create(key, data);
        assert(res == true, `unexpected create result ${res}`);

        let updated = await storage.update<Data>(key, Data, async (data) => {
            data.foo = 42;
            return true;
        });
        assert(updated instanceof Data, `unexpected update result ${JSON.stringify(updated)}`);
        assert(updated.foo == 42);

        updated = await storage.update<Data>(key, Data, async (data) => {
            data.foo = 43;
            return false;
        });

        const readData = await storage.read<Data>(key, Data);
        assert(readData instanceof Data, `unexpected read result ${readData}`);
        assert(readData != null, `unexpected read result ${readData}`);
        assert(readData.foo == 42, `got ${JSON.stringify(res)}`);

        await storage.destroy();
    });

    it(`storage concurrent update`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let res = await storage.create(key, data);
        assert(res == true, `unexpected create result ${res}`);

        const update1 = storage.update(key, Data, async (data) => {
            await setTimeout(1000);
            assert(data.foo == 1234, `expected data.foo=1234, got ${data}`);
            data.foo = 42;
            return true;
        });

        await setTimeout(250);
        const update2 = storage.update(key, Data, async (data) => {
            assert(data.foo == 42, `expected data.foo=42, got ${JSON.stringify(data)}`);
            data.foo++;
            return true;
        });

        await Promise.all([update1, update2]);
        const readRes = await storage.read<Data>(key, Data);
        assert(readRes instanceof Data, `unexpected read result ${readRes}`);
        assert(readRes != null, `unexpected read result ${readRes}`);
        assert(readRes.foo == 43, `expected 43, got ${JSON.stringify(res)}`);

        await storage.destroy();
    });

    it(`storage long-running update`, async () => {
        const storage = new Storage("test");
        const key = crypto.randomBytes(20).toString('hex');

        const data = new Data(1234, "string")
        let res = await storage.create(key, data);
        assert(res == true, `unexpected create result ${res}`);

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

    it(`storage list`, async () => {
        const keyPrefix = crypto.randomBytes(20).toString('hex');
        const storage = new Storage(keyPrefix);

        const data = new Data(1234, "string")

        for (let index = 0; index < 10; index++) {
            data.foo = index;
            await storage.create(String(index), data);
        }

        let result = 0;
        let state: ListResult | undefined = undefined;
        while (true) {
            state = await storage.list(state, 1);
            const keys = state.keys;

            if (keys.length > 0) {
                assert(keys.length == 1, `expected one entry, got ${keys.length}, ${JSON.stringify(state)}`);
                result += keys.length;
            }

            if (state.cursor == null) {
                break;
            }
        }

        assert(result == 10, `unexpected number of results, got ${result}`);
        await storage.destroy();
    });

});