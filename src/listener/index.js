import assert from 'assert/strict';
import HttpListener from './http-listener.js';

class Listener {

    static {
        this._listeners = {}
    }

    static _getNewListener(method, port, state) {
        switch (method) {
            case 'http':
                return new HttpListener({port, state});
            default:
                assert.fail(`unknown listener method ${method}`);
        }
    }

    static acquire(listener, port, state = {}) {
        const k = `${listener}-${port}`;
        if (!this._listeners[k]) {
            this._listeners[k] = this._getNewListener(listener, port, state);
        } else {
            this._listeners[k].acquire();
        }
        return this._listeners[k];
    }

    static async release(listener, port) {
        const k = `${listener}-${port}`;
        if (!this._listeners[k]) {
            return;
        }
        const released = await this._listeners[k].destroy();
        if (released) {
            delete this._listeners[k];
        }
    }

}

export default Listener;