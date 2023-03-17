import assert from 'assert/strict';
import MemoryEventBus from './memory-eventbus.js';
import RedisEventBus from './redis-eventbus.js';

class ClusterService {
    constructor(type, opts) {
        if (ClusterService.instance instanceof ClusterService) {
            ClusterService.ref++;
            return ClusterService.instance;
        }
        assert(type != null, "type not given");
        ClusterService.instance = this;
        ClusterService.ref = 1;

        this._listeners = [];
        const onMessage = (event, message) => {
            this.emit(event, message);
        };

        const ready = (err) => {
            typeof opts.callback === 'function' && process.nextTick(() => opts.callback(err));
        };

        switch (type) {
            case 'redis':
                this._bus = new RedisEventBus({
                    ...opts,
                    callback: ready,
                    handler: onMessage,
                })
                break;
            case 'mem':
                this._bus = new MemoryEventBus({
                    ...opts,
                    callback: ready,
                    handler: onMessage,
                });
                break;
            default:
                assert.fail(`unknown type ${type}`);
        }
    }

    attach(bus) {
        this._listeners.push(bus);
    }

    detach(bus) {
        this._listeners = this._listeners.filter((x) => x != bus);
    }

    emit(event, message) {
        this._listeners.forEach((l) => l._emit(event, message));
    }

    async publish(event, message) {
        return this._bus.publish(event, message);
    }

    async destroy() {
        if (--ClusterService.ref == 0) {
            await this._bus.destroy();
            this.destroyed = true;
            delete this._bus;
            delete ClusterService.instance;
        }
    }
}

export default ClusterService;