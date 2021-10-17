import assert from 'assert/strict';
import { EventEmitter } from 'events';

class Transport extends EventEmitter {
    createConnection(opts = {}, callback) {
        assert.fail("createConnection not implemented");
    }

    destroy() {
        assert.fail("destroy not implemented");
    }
}

export default Transport