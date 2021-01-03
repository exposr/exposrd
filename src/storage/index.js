import InMemoryStorage from './inmemory-storage.js';

class Storage {
    constructor(namespace) {
        return new InMemoryStorage(namespace);
    }
}

export default Storage;