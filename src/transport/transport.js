import assert from 'assert/strict';
import { EventEmitter } from 'events';

class Transport extends EventEmitter {
    constructor(opts) {
        super();
        this.max_connections = opts.max_connections || 1;
    }

    createConnection(opts = {}, callback) {
        assert.fail("createConnection not implemented");
    }

    destroy() {
        assert.fail("destroy not implemented");
    }
}

export default Transport