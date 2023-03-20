import assert from 'assert/strict';
import crypto from 'crypto';
import MemoryEventBus from './memory-eventbus.js';
import RedisEventBus from './redis-eventbus.js';
import Node from '../utils/node.js';
import { Logger } from '../logger.js';
import UdpEventBus from './udp-eventbus.js';

class ClusterService {
    constructor(type, opts) {
        if (ClusterService.instance instanceof ClusterService) {
            ClusterService.ref++;
            return ClusterService.instance;
        }
        assert(type != null, "type not given");
        ClusterService.instance = this;
        ClusterService.ref = 1;

        this.logger = Logger("cluster-service");
        this._key = 'cb8f34580bd6179cfe1b3db1f08a13704899eab3380f7a79444cceb0aefed010';

        this._listeners = [];
        const onMessage = (payload) => {
            this._receive(payload)
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
            case 'udp':
                this._bus = new UdpEventBus({
                    ...opts,
                    callback: ready,
                    handler: onMessage,
                });
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

    _receive(payload) {
        try {
            const msg = JSON.parse(payload);
            const {s, ...data} = msg;

            const data_s = JSON.stringify(data);
            const signature = crypto.createHmac('sha256', this._key).update(data_s).digest('hex');
            if (s !== signature) {
                this.logger.debug({
                    message: `invalid message signature: ${signature}`,
                    payload
                });
                return;
            }

            const {event, message, node, ts} = data;
            this._listeners.forEach((l) => l._emit(event, message, {node, ts}));
        } catch (e) {
            this.logger.debug({
                message: `receive failed invalid message: ${e.message}`,
                payload
            });
        }
    }

    async publish(event, message) {
        const payload = {
            event,
            message,
            node: {
                id: Node.identifier,
                host: Node.hostname,
                ip: Node.address,
            },
            ts: new Date().getTime(),
        };

        const data_s = JSON.stringify(payload);
        const signature = crypto.createHmac('sha256', this._key).update(data_s).digest('hex');

        const msg = {
            ...payload,
            s: signature
        };

        return this._bus.publish(JSON.stringify(msg));
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