import Mutex from "../utils/mutex.js";

class InmemLock {
    constructor() {
        this._locks = {};
        this._abort = new AbortController();
    }

    async lock(resource) {
        this._locks[resource] ??= new Mutex();
        const mutex = this._locks[resource];

        return mutex.acquire(this._abort.signal)
            .catch((err) => {
                delete this._locks[resource];
                throw err;
            }).then(() => {
                return {
                    active: () => { return true },
                    unlock: async () => {
                        mutex.release();
                        if (!mutex._locked) {
                            delete this._locks[resource];
                        }
                    }
                }
            });
    }

    async destroy() {
        this._abort.abort();
        this._locks = {};
        return true;
    }
}

export default InmemLock;