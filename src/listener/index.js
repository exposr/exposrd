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

    _call_listeners(fn) {
        const allListeners = [];
        Object.keys(this.listeners).forEach((k) => {
            const listener = this.listeners[k];
            allListeners.push(new Promise((resolve, reject) => {
                listener[fn]((err) => {
                    if (err === undefined) {
                        resolve();
                    } else {
                        reject(err);
                    }
                });
            }));
        });
        return allListeners;
    }

    listen(cb) {
        Promise.all(this._call_listeners('listen')).then(vals => {
            cb();
        }).catch(rejected => {
            cb(new Error("Failed to start listeners"));
        });
    }

    shutdown(cb) {
        Promise.all(this._call_listeners('shutdown')).then(vals => {
            cb();
        }).catch(rejected => {
            cb();
        });
    }
}

export default Listener;