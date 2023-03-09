
class InmemLock {
    constructor() {
    }

    async lock(resource) {
        return {
            active: () => { return true; },
            unlock: async () => { return true; }
        }
    }

    async destroy() {
        return true;
    }
}

export default InmemLock;