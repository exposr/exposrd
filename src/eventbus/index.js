import { EventEmitter } from 'events';
import os from 'os';

class EventBus extends EventEmitter {
    constructor() {
        if (EventBus.instance instanceof EventBus) {
            return EventBus.instance;
        }
        super();
        EventBus.instance = this;
        this._host = `${process.pid}@${os.hostname}`;

        this.setMaxListeners(1);
        this.on('newListener', () => {
            this.setMaxListeners(this.getMaxListeners() + 1);
        });
        this.on('removeListener', () => {
            this.setMaxListeners(this.getMaxListeners() + 1);
        });
    }

    emit(channel, message) {
        super.emit(channel, {
            ...message,
            _host: this._host,
            _ts: new Date().getTime(),
        });
    }

    waitFor(channel, predicate, timeout = undefined) {
        return new Promise((resolve, reject) => {
            let timer;
            const fun = (message) => {
                if (!predicate(message)) {
                    return;
                }
                this.removeListener(channel, fun);
                timer && clearTimeout(timer);
                resolve();
            };
            this.on(channel, fun)
            if (typeof timeout === 'number') {
                timer = setTimeout(fun, reject)
            }
        });
    }
}

export default EventBus;