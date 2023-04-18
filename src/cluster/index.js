import assert from 'assert/strict';
import crypto from 'crypto';
import MemoryEventBus from './memory-eventbus.js';
import RedisEventBus from './redis-eventbus.js';
import Node from './cluster-node.js';
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
        this._key = opts.key || '';
        this._nodes = {};
        this._nodes[Node.identifier] = {
            seq: 0,
            seq_win: 0,
            id: Node.identifier,
            host: Node.hostname,
            ip: Node.address,
            stale: false,
        };
        this._seq = 0;
        this._window_size = 16;

        this._staleTimeout = opts.staleTimeout || 30000;
        this._removalTimeout = opts.removalTimeout || 60000;
        this._heartbeatInterval = opts.heartbeatInterval || 9500;

        this._listeners = [];
        const onMessage = (payload) => {
            this._receive(payload)
        };

        const ready = async (err) => {
            if (err) {
                await this.destroy();
            }
            this.logger.info(`Clustering mode ${type} initialized`);
            typeof opts.callback === 'function' && process.nextTick(() => opts.callback(err));
        };

        switch (type) {
            case 'redis':
                this._bus = new RedisEventBus({
                    ...opts.redis,
                    callback: ready,
                    handler: onMessage,
                })
                break;
            case 'udp':
                this._bus = new UdpEventBus({
                    ...opts.udp,
                    callback: ready,
                    handler: onMessage,
                });
                break;
            case 'single-node':
            case 'mem':
                this._bus = new MemoryEventBus({
                    callback: ready,
                    handler: onMessage,
                });
                break;
            default:
                assert.fail(`unknown type ${type}`);
        }
    }

    setReady() {
        const heartbeat = () => {
            this.publish("cluster:heartbeat");
        };
        heartbeat();
        this._heartbeat = setInterval(heartbeat, this._heartbeatInterval);
    }

    attach(bus) {
        this._listeners.push(bus);
    }

    detach(bus) {
        this._listeners = this._listeners.filter((x) => x != bus);
    }

    _learnNode(node) {
        if (node?.id == undefined || node?.id == Node.identifier) {
            return;
        }

        clearTimeout(this._nodes[node.id]?._staleTimer);
        clearTimeout(this._nodes[node.id]?._removalTimer);

        if (!this._nodes[node.id]) {
            this.logger.debug({
                message: `learnt node ${node.id}`,
                node,
            });
        }

        this._nodes[node.id] ??= {
            seq: 0,
            seq_win: 0,
        };
        this._nodes[node.id].id = node.id;
        this._nodes[node.id].host = node.host;
        this._nodes[node.id].ip = node.ip;
        this._nodes[node.id].stale = false;

        this._nodes[node.id]._staleTimer = setTimeout(() => {
            this._staleNode(node);
        }, this._staleTimeout);

        this._nodes[node.id]._staleTimer = setTimeout(() => {
            this._forgetNode(node);
        }, this._removalTimeout);

    }

    _forgetNode(node) {
        this.logger.debug({
            message: `deleting node ${node.id}`
        });
        delete this._nodes[node.id];
    }

    _staleNode(node) {
        if (!this._nodes[node?.id]) {
            return;
        }
        this._nodes[node.id].stale = true;
        this.logger.debug({
            message: `marking ${node.id} as stale`
        });
    }

    getSelf() {
        return  {
            id: Node.identifier,
            host: Node.hostname,
            ip: Node.address,
        };
    }

    getNode(id) {
        const node = this._nodes[id];
        if (node?.stale === false) {
            return {
                id: node.id,
                host: node.host,
                ip: node.ip,
            };
        } else {
            return undefined;
        }
    }

    _receive(payload) {
        try {
            const msg = JSON.parse(payload);
            const {s, ...data} = msg;

            const data_s = JSON.stringify(data);
            const signature = crypto.createHmac('sha256', this._key).update(data_s).digest('hex');
            if (s !== signature) {
                throw new Error(`invalid message signature: ${s}`);
            }

            const {event, message, node, ts, seq} = data;
            if (event == 'cluster:heartbeat' || this.getNode(node?.id) == undefined) {
                this._learnNode(node);
            }

            if (this.getNode(node?.id) == undefined) {
                throw new Error(`The node ${node?.id} is not in set of learnt nodes`);
            }

            const low = this._nodes[node.id].seq - this._window_size;
            if (low > seq || seq < 0) {
                throw new Error(`unexpected sequence number ${seq}, window=${this._nodes[node.id].seq}`);
            }

            if (seq > this._nodes[node.id].seq) {
                const diff = seq - this._nodes[node.id].seq;

                this._nodes[node.id].seq = seq;

                this._nodes[node.id].seq_win <<= diff;
                this._nodes[node.id].seq_win &= (1 << this._window_size) - 1;
            }

            const rel_seq = this._nodes[node.id].seq - seq;
            if (this._nodes[node.id].seq_win & (1 << rel_seq)) {
                throw new Error(`message ${seq} already received, window=${this._nodes[node.id].seq}`);
            }
            this._nodes[node.id].seq_win |= (1 << rel_seq);

            this._listeners.forEach((l) => l._emit(event, message, {node, ts}));
            return true;
        } catch (e) {
            this.logger.debug({
                message: `receive failed invalid message: ${e.message}`,
                payload
            });
            return e;
        }
    }

    async publish(event, message = {}) {
        const payload = {
            event,
            message,
            node: {
                id: Node.identifier,
                host: Node.hostname,
                ip: Node.address,
            },
            ts: new Date().getTime(),
            seq: this._seq,
        };

        const data_s = JSON.stringify(payload);
        const signature = crypto.createHmac('sha256', this._key).update(data_s).digest('hex');

        const msg = {
            ...payload,
            s: signature
        };
        this._seq++;
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