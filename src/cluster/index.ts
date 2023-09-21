import assert from 'assert/strict';
import crypto from 'crypto';
import MemoryEventBus from './memory-eventbus.js';
import RedisEventBus from './redis-eventbus.js';
import Node from './cluster-node.js';
import { Logger } from '../logger.js';
import UdpEventBus from './udp-eventbus.js';
import EventBus from './eventbus.js';

type ClusterNode = {
    id: string,
    host: string,
    ip: string,
    last_ts: number,
    stale: boolean,
}

type ClusterServiceNode = ClusterNode & {
    seq: number,
    seq_win: number,
    staleTimer?: NodeJS.Timeout,
    removalTimer?: NodeJS.Timeout,
}

class ClusterService {
    private static instance: ClusterService | undefined; 
    private static ref: number;

    private logger: any;
    private _key: string = '';
    private _nodes: { [key: string]: ClusterServiceNode } = {}; 
    private _listeners: Array<EventBus> = [];
    private _seq: number = 0;
    private _window_size!: number;
    private _staleTimeout!: number;
    private _removalTimeout!: number;
    private _heartbeatInterval!: number;
    private _bus: any;
    private multiNode: boolean = false;
    private _heartbeat: NodeJS.Timeout | undefined;

    constructor(type?: 'redis' | 'udp' | 'single-node' | 'mem', opts?: any) {
        if (ClusterService.instance instanceof ClusterService) {
            ClusterService.ref++;
            return ClusterService.instance;
        }
        assert(type != null, "type not given");
        ClusterService.instance = this;
        ClusterService.ref = 1;

        this.logger = Logger("cluster-service");
        this._key = opts?.key || '';
        this._nodes = {};
        this._nodes[Node.identifier] = {
            seq: 0,
            seq_win: 0,
            id: Node.identifier,
            host: Node.hostname,
            ip: Node.address,
            stale: false,
            last_ts: 0,
        };
        this._seq = 0;
        this._window_size = 16;

        this._staleTimeout = opts.staleTimeout || 30000;
        this._removalTimeout = opts.removalTimeout || 60000;
        this._heartbeatInterval = opts.heartbeatInterval || 9500;

        this._listeners = [];
        const onMessage = (payload: string) => {
            this._receive(payload)
        };

        const ready = async (err: Error) => {
            if (err) {
                await this.destroy();
            }
            this.logger.info(`Clustering mode ${type} initialized`);
            typeof opts.callback === 'function' && process.nextTick(() => opts.callback(err));
        };

        const getLearntPeers = () => {
            return this._getLearntPeers();
        };

        switch (type) {
            case 'redis':
                this.multiNode = true;
                this._bus = new RedisEventBus({
                    ...opts.redis,
                    callback: ready,
                    handler: onMessage,
                })
                break;
            case 'udp':
                this.multiNode = true;
                this._bus = new UdpEventBus({
                    ...opts.udp,
                    callback: ready,
                    handler: onMessage,
                    getLearntPeers,
                });
                break;
            case 'single-node':
            case 'mem':
                this.multiNode = false;
                this._bus = new MemoryEventBus({
                    callback: ready,
                    handler: onMessage,
                });
                break;
            default:
                assert.fail(`unknown type ${type}`);
        }
    }

    public async setReady(ready: boolean = true): Promise<boolean> {
        if (!ready) {
            clearInterval(this._heartbeat);
            return this.multiNode;
        }

        const heartbeat = () => {
            this.publish("cluster:heartbeat");
        };
        heartbeat();
        this._heartbeat = setInterval(heartbeat, this._heartbeatInterval);

        if (!this.multiNode) {
            return this.multiNode;
        }

        const rapidHeartbeat = setInterval(heartbeat, 2000);
        const waitTime = (this._heartbeatInterval * 2) + 1000;
        this.logger.info({
            message: `Waiting ${waitTime/1000} seconds for initial peer discovery to complete`
        });

        await new Promise((resolve) => {
            setTimeout(resolve, waitTime);
        });
        clearInterval(rapidHeartbeat);
        return this.multiNode;
    }

    public attach(bus: EventBus): void {
        this._listeners.push(bus);
    }

    public detach(bus: EventBus): void {
        this._listeners = this._listeners.filter((x) => x != bus);
    }

    private _getLearntPeers(): Array<string> {
        return Array.from(new Set(Object.keys(this._nodes)
            .filter((k) => !this._nodes[k].stale)
            .map((k) => this._nodes[k].ip)));
    }

    private _learnNode(node: ClusterNode): ClusterServiceNode | undefined {
        if (node.id == undefined || node.id == Node.identifier) {
            return;
        }

        let cnode: ClusterServiceNode;
        if (this._nodes[node.id] == undefined) {
            this.logger.info({
                message: `Discovered peer node ${node.id}, host ${node.host} (${node.ip}), total peers ${Object.keys(this._nodes).length}`,
                total_nodes: Object.keys(this._nodes).length + 1,
            });
            cnode = {
                seq: 0,
                seq_win: 0,
                ...node,
            }
        } else {
            cnode = this._nodes[node.id];
        }
        
        if (cnode.stale == true) {
            this.logger.debug({
                message: `node ${node.id} no longer marked as stale`,
                node,
            });
        }
        cnode.id = node.id;
        cnode.host = node.host;
        cnode.ip = node.ip;
        cnode.stale = false;

        clearTimeout(cnode.staleTimer);
        cnode.staleTimer = setTimeout(() => {
            this._staleNode(cnode);
        }, this._staleTimeout);

        clearTimeout(cnode.removalTimer);
        cnode.removalTimer = setTimeout(() => {
            this._forgetNode(cnode);
        }, this._removalTimeout);

        this._nodes[node.id] = cnode;
        return cnode;
    }

    private _forgetNode(node: ClusterServiceNode): void {
        delete this._nodes[node.id];
        this.logger.info({
            message: `Node ${node.id} ${node.host} (${node.ip}) permanently removed from peer list`,
            total_nodes: Object.keys(this._nodes).length,
        });
    }

    private _staleNode(node: ClusterServiceNode): void {
        if (!this._nodes[node?.id]) {
            return;
        }
        this._nodes[node.id].stale = true;
        this.logger.debug({
            message: `marking ${node.id} as stale`
        });
    }

    public getSelf(): ClusterNode  {
        return  {
            id: Node.identifier,
            host: Node.hostname,
            ip: Node.address,
            last_ts: new Date().getTime(),
            stale: false,
        };
    }

    public getNode(id: string): ClusterNode | undefined {
        const node: ClusterServiceNode = this._nodes[id];
        if (node?.stale === false) {
            return {
                id: node.id,
                host: node.host,
                ip: node.ip,
                last_ts: node.last_ts,
                stale: node.stale,
            };
        } else {
            return undefined;
        }
    }

    public getNodes(): Array<ClusterNode> {
        return Object.keys(this._nodes).map((k) => {
            return {
                id: this._nodes[k].id,
                host: this._nodes[k].host,
                ip: this._nodes[k].ip,
                last_ts: Node.identifier == this._nodes[k].id ? new Date().getTime() : this._nodes[k].last_ts,
                stale: this._nodes[k].stale,
            }
        })
    }

    private _receive(payload: string): boolean | Error {
        try {
            const msg = JSON.parse(payload);
            const {s, ...data} = msg;

            const data_s = JSON.stringify(data);
            const signature = crypto.createHmac('sha256', this._key).update(data_s).digest('hex');
            if (s !== signature) {
                throw new Error(`invalid message signature: ${s}`);
            }

            const {event, message, node, ts, seq} = data;
            if (event == undefined ||
                message == undefined ||
                node == undefined ||
                ts == undefined ||
                seq == undefined) {
                throw new Error(`invalid message ${payload}`);
            }

            const cnode: ClusterNode = {
                id: node.id,
                host: node.host,
                ip: node.ip,
                last_ts: ts,
                stale: false,
            }

            let csnode: ClusterServiceNode | undefined = this._nodes[cnode.id];
            if (event == 'cluster:heartbeat' || csnode == undefined) {
                csnode = this._learnNode(node);
            }

            if (csnode == undefined) {
                throw new Error(`The node ${cnode.id} is not in set of learnt nodes`);
            }

            const low = csnode.seq - this._window_size;
            if (low > seq || seq < 0) {
                throw new Error(`unexpected sequence number ${seq}, window=${csnode.seq}`);
            }

            if (seq > csnode.seq) {
                const diff = seq - csnode.seq;

                csnode.seq = seq;

                csnode.seq_win <<= diff;
                csnode.seq_win &= (1 << this._window_size) - 1;
            }

            const rel_seq = csnode.seq - seq;
            if (csnode.seq_win & (1 << rel_seq)) {
                throw new Error(`message ${seq} already received, window=${csnode.seq}`);
            }
            csnode.seq_win |= (1 << rel_seq);

            this._listeners.forEach((l) => l._emit(event, message, {
                node: {
                    id: cnode.id,
                    ip: cnode.ip,
                    host: cnode.host,
                },
                ts
            }));
            return true;
        } catch (e: any) {
            this.logger.debug({
                message: `receive failed invalid message: ${e.message}`,
                payload
            });
            return e;
        }
    }

    public async publish(event: any, message: object = {}) {
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

    public async destroy() {
        if (--ClusterService.ref == 0) {
            await this._bus.destroy();
            this._bus = undefined;
            ClusterService.instance = undefined;
        }
    }
}

export default ClusterService;