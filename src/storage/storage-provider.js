import assert from 'assert/strict';

class StorageProvider {
    constructor(props) {
    }

    async destroy() {
        assert.fail("StorageProvider destroy not implemented");
    }

    async init(ns) {
        assert.fail("StorageProvider init not implemented");
    }

    compound_key(ns, key) {
        assert(key !== undefined);
        assert(ns !== undefined);
        if (key instanceof Array) {
            return key.map((k) => `${ns}:${k}`);
        } else {
            return `${ns}:${key}`;
        }
    }

    key_only(ns, key) {
        return key.slice(key.indexOf(ns) + ns.length + 1);
    }

    async get(ns, key, opts) {
        assert.fail("StorageProvider get not implemented");
    }

    async mget(ns, keys) {
        assert.fail("StorageProvider mget not implemented");
    }

    async set(ns, key, data, opts = {}) {
        assert.fail("StorageProvider set not implemented");
    }

    async delete(ns, key) {
        assert.fail("StorageProvider delete not implemented");
    }

    async list(ns, cursor, count = 10) {
        assert.fail("StorageProvider list not implemented");
    }
}

export default StorageProvider;