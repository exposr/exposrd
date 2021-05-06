
class InmemLock {
    constructor() {
    }

    async lock(resource) {
        return {
            unlock: () => { return true; }
        }
    }
}

export default InmemLock;