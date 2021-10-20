import assert from 'assert/strict';
import HttpListener from './http-listener.js';

class Listener {
    constructor() {
        if (Listener.instance !== undefined) {
            return Listener.instance
        }
        Listener.instance = this;
        this._listeners = {}
    }

    _getNewListener(method, port) {
        switch (method) {
            case 'http':
                return new HttpListener({port});
            default:
                assert.fail(`unknown listener method ${method}`);
        }
    }

    getListener(listener, port) {
        const k = `${listener}-${port}`;
        if (!this._listeners[k]) {
            this._listeners[k] = this._getNewListener(listener, port);
        }
        return this._listeners[k];
    }
}

export default Listener;