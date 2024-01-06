import crypto from 'node:crypto';
import MemoryEventBus from './memory-eventbus.js';
import RedisEventBus, { RedisEventBusOptions } from './redis-eventbus.js';
import Node from './cluster-node.js';
import { Logger } from '../logger.js';
import UdpEventBus, { UdpEventBusOptions } from './udp-eventbus.js';
import { EmitMeta } from './eventbus.js';
import EventBusInterface from './eventbus-interface.js';

export type ClusterManagerOptions = {
    key?: string,
    staleTimeout?: number,
    removalTimeout?: number,
    heartbeatInterval?: number,
    redis?: RedisEventBusOptions,
    udp?: UdpEventBusOptions,
}

export enum ClusterManagerType {
    REDIS = 'redis',
    UDP = 'udp',
    SINGLE_NODE = 'single-node',
    MEM = 'mem',
}

export type ClusterNode = {
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

export type EmitCallback = (event: string, message: any, meta: EmitMeta) => void;

class ClusterManager {
    private static logger: any;
    private static _key: string = '';
    private static _nodes: { [key: string]: ClusterServiceNode } = {}; 
    private static _listeners: Array<EmitCallback> = [];
    private static _seq: number = 0;
    private static _window_size: number;
    private static _staleTimeout: number;
    private static _removalTimeout: number;
    private static _heartbeatInterval: number;
    private static _bus: EventBusInterface;
    private static multiNode: boolean = false;
    private static _heartbeat: NodeJS.Timeout | undefined;

    private static initialized: boolean = false;
    private static ready: boolean = false;

    public static async init(type: ClusterManagerType, opts?: ClusterManagerOptions): Promise<void> {
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

        this._staleTimeout = opts?.staleTimeout || 30000;
        this._removalTimeout = opts?.removalTimeout || 60000;
        this._heartbeatInterval = opts?.heartbeatInterval || 9500;

        this._listeners = [];

        try {
            await new Promise((resolve, reject) => {

                const ready = (err?: Error) => {
                    err ? reject(err) : resolve(undefined);
                };

                switch (type) {
                    case ClusterManagerType.REDIS:
                        this.multiNode = true;
                        this._bus = new RedisEventBus({
                            ...<RedisEventBusOptions>opts?.redis,
                            callback: ready,
                        })
                        break;
                    case ClusterManagerType.UDP:
                        this.multiNode = true;
                        this._bus = new UdpEventBus({
                            ...<UdpEventBusOptions>opts?.udp,
                            callback: ready,
                        });
                        break;
                    case ClusterManagerType.SINGLE_NODE:
                    case ClusterManagerType.MEM:
                        this.multiNode = false;
                        this._bus = new MemoryEventBus({
                            callback: ready,
                        });
                        break;
                    default:
                        reject(new Error(`no_such_cluster_type`));
                }
            });
        } catch (e: any) {
            throw e;
        }

        this.initialized = true;
        this.ready = false;
        this.logger.info(`Clustering mode ${type} initialized`);
    }

    public static async close(): Promise<void> {
        if (!this.initialized) {
            return;
        }
        this.stop();
        await this._bus.destroy();
        this._bus = <any>undefined;
        this.initialized = false;
    }

    public static isMultinode(): boolean {
        return this.multiNode;
    }

    public static async start(): Promise<void> {
        if (this.ready) {
            return;
        }

        this.ready = true;

        const heartbeat = () => {
            this.publish("cluster:heartbeat");
        };
        heartbeat();
        this._heartbeat = setInterval(heartbeat, this._heartbeatInterval);

        if (!this.multiNode) {
            return;
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
    }

    public static stop(): void {
        this.ready = false;
        clearInterval(this._heartbeat);
        this._heartbeat = undefined;
    }

    public static attach(callback: EmitCallback): void {
        this._listeners.push(callback);
    }

    public static detach(callback: EmitCallback): void {
        this._listeners = this._listeners.filter((x) => x != callback);
    }

    public static getLearntPeers(): Array<string> {
        return Array.from(new Set(Object.keys(this._nodes)
            .filter((k) => !this._nodes[k].stale)
            .map((k) => this._nodes[k].ip)));
    }

    private static _learnNode(node: ClusterNode): ClusterServiceNode | undefined {
        if (node?.id == undefined) {
            return undefined;
        }
        if (node.id == Node.identifier) {
            return this._nodes[node.id];
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
        cnode.last_ts = node.last_ts;
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

    private static _forgetNode(node: ClusterServiceNode): void {
        delete this._nodes[node.id];
        this.logger.info({
            message: `Node ${node.id} ${node.host} (${node.ip}) permanently removed from peer list`,
            total_nodes: Object.keys(this._nodes).length,
        });
    }

    private static _staleNode(node: ClusterServiceNode): void {
        if (!this._nodes[node?.id]) {
            return;
        }
        this._nodes[node.id].stale = true;
        this.logger.debug({
            message: `marking ${node.id} as stale`
        });

    }

    public static getSelf(): ClusterNode  {
        return  {
            id: Node.identifier,
            host: Node.hostname,
            ip: Node.address,
            last_ts: Date.now(),
            stale: false,
        };
    }

    public static getNode(id: string): ClusterNode | undefined {
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

    public static getNodes(): Array<ClusterNode> {
        return Object.keys(this._nodes).map((k) => {
            return {
                id: this._nodes[k].id,
                host: this._nodes[k].host,
                ip: this._nodes[k].ip,
                last_ts: Node.identifier == this._nodes[k].id ? Date.now() : this._nodes[k].last_ts,
                stale: this._nodes[k].stale,
            }
        })
    }

    public static receive(payload: string): boolean | Error {
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
                csnode = this._learnNode(cnode);
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

            this._listeners.forEach((cb) => cb(event, message, {
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

    public static async publish(event: any, message: any = {}) {
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

}

export default ClusterManager;