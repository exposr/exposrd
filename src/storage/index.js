import InMemoryStorage from './inmemory-storage.js';

class Storage {
    constructor(namespace, opts = {}) {
        return new InMemoryStorage(namespace, opts);
    }
}

export default Storage;