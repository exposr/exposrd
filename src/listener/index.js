import HttpListener from './http-listener.js';

class Listener {
    constructor(opts) {
        if (Listener.instance !== undefined) {
            return Listener.instance
        }
        this.opts = opts;

        this.listeners = {}
        if (opts.http) {
            this.listeners['http'] = new HttpListener(opts.http);
        }

        Listener.instance = this;
    }

    getListener(listener) {
        const l = this.listeners[listener];
        if (l === undefined) {
            throw new Error(`no listener '${listener}' configured`);
        }
        return l;
    }

    _call_listeners_async(fn) {
        const allListeners = [];
        Object.keys(this.listeners).forEach((k) => {
            const listener = this.listeners[k];
            allListeners.push(listener[fn]())
        });
        return allListeners;
    }

    async listen() {
        return Promise.all(this._call_listeners_async('listen'));
    }

    async destroy() {
        try {
            await Promise.all(this._call_listeners_async('destroy'))
        } catch (e) {
        }
    }
}

export default Listener;