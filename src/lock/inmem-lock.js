
class InmemLock {
    constructor() {
    }

    async lock(resource) {
        return {
            unlock: () => { return true; }
        }
    }

    async destroy() {
        return true;
    }
}

export default InmemLock;