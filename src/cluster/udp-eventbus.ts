import assert from 'assert/strict';
import dgram from 'dgram';
import net from 'net';
import { Logger } from '../logger.js';
import MulticastDiscovery, { MulticastDiscoveryOptions } from './multicast-discovery.js';
import KubernetesDiscovery, { KubernetesDiscoveryOptions } from './kubernetes-discovery.js';
import EventBusInterface, { EventBusInterfaceOptions } from './eventbus-interface.js';
import DiscoveryMethod from './discovery-method.js';

export type UdpEventBusOptions = {
    port: number,
    discoveryMethod: "multicast" | "kubernetes" | undefined,
    multicast: MulticastDiscoveryOptions,
    kubernetes: KubernetesDiscoveryOptions,
}

type _UdpEventBusOptions = EventBusInterfaceOptions & UdpEventBusOptions & {
    callback: (error?: Error) => void
}

class UdpEventBus extends EventBusInterface {
    private logger: any;
    private _port: number;
    private _discoveryMethods: { [key: string]: DiscoveryMethod } = {}; 
    private _discoveryMethod: DiscoveryMethod | undefined;
    private _socket: dgram.Socket | undefined;
    private _socket6: dgram.Socket | undefined;

    constructor(opts: _UdpEventBusOptions) {
        super(opts);

        this.logger = Logger("udp-eventbus");

        this._port = opts.port || 1025;

        try {
            this._discoveryMethods = {
                multicast: new MulticastDiscovery({
                    ...opts.multicast,
                }),
                kubernetes: new KubernetesDiscovery({
                    ...opts.kubernetes
                }),
            };
        } catch (e: any) {
            if (typeof opts.callback === 'function') {
                process.nextTick(() => { opts.callback(e) });
            } else {
                throw e;
            }
            return;
        }

        if (opts.discoveryMethod) {
            this._discoveryMethod = this._discoveryMethods[opts.discoveryMethod];
            if (!(this._discoveryMethod?.eligible() >= 0)) {
                const e = new Error(`Selected peer discovery method ${opts.discoveryMethod} could not be used`);
                if (typeof opts.callback === 'function') {
                    process.nextTick(() => { opts.callback(e) });
                } else {
                    throw e;
                }
                return;
            }
        } else {
            const eligibleMethods = Object.keys(this._discoveryMethods)
                .map((key) => {
                    const method = this._discoveryMethods[key];
                    const eligible = method.eligible();
                    return { method, eligible };
                })
                .filter(({ eligible }) => eligible >= 0)
                .sort((a, b) => b.eligible - a.eligible);

            this._discoveryMethod = eligibleMethods.length > 0 ? eligibleMethods[0].method : undefined;
        }

        if (this._discoveryMethod == undefined) {
            process.nextTick(() => { opts.callback(new Error('No working discovery methods available'))});
            return
        }
        assert(this._discoveryMethod != undefined);

        const onMessage = (data: Buffer, rinfo: dgram.RemoteInfo) => {
            if (data.length <= 5) {
                return;
            }

            const header = new Uint8Array(data.buffer.slice(0, 4));
            const msg = Buffer.from(data.buffer.slice(4));

            if (!(header[0] == 0xE0 && header[1] == 0x05)) {
                return;
            }

            try {
                this.receive(msg.toString('utf-8'));
            } catch (e: any) {
                this.logger.error({
                    message: `Failed to receive message ${msg}`
                });
            }
        };

        const createSocket = (type: dgram.SocketType): Promise<dgram.Socket> => {
            return new Promise((resolve, reject) => {
                const sock = dgram.createSocket({ type, reuseAddr: true });
                sock.on('message', onMessage);

                const connectError = (err: Error) => {
                    sock.close();
                    reject(err);
                };

                sock.once('error', connectError);
                sock.bind(this._port, () => {
                    sock.removeListener('error', connectError);
                    resolve(sock);
                });
            })
        };

        Promise.allSettled([
            createSocket('udp4'),
            createSocket('udp6')
        ]).then((results) => {
            const [result4, result6] = results;

            let mode = '';
            if (result4.status == 'fulfilled') {
                this._socket = result4.value;
                mode += 'IPv4';
            }
            if (result6.status == 'fulfilled') {
                this._socket6 = result6.value;
                mode += `${mode != '' ? '/' : ''}IPv6`;
            }

            if (result4.status == 'rejected' && result6.status == 'rejected') {
                typeof opts.callback === 'function' && process.nextTick(() => { opts.callback(result4.reason) });
                return;
            }

            this._discoveryMethod?.init(this._socket, this._socket6);
            this.logger.info({
                message: `Cluster interface on ${this._port} (${mode}) using discovery method ${this._discoveryMethod?.name}`,
            });
            typeof opts.callback === 'function' && process.nextTick(opts.callback);
        });
    }

    protected async _destroy(): Promise<void> {
        await Promise.allSettled([
            new Promise((resolve, reject) => {
                if (this._socket) {
                    this._socket.close(() => { resolve(undefined) });
                } else {
                    resolve(undefined);
                }
            }),
            new Promise((resolve, reject) => {
                if (this._socket6) {
                    this._socket6.close(() => { resolve(undefined) });
                } else {
                    resolve(undefined);
                }
            })
        ])
    }

    protected async _publish(message: any): Promise<void> {
        const receivers = (await this._discoveryMethod?.getPeers()) || [];

        const header = Buffer.allocUnsafe(4);
        header.writeUInt8(0xE0, 0);
        header.writeUInt8(0x05, 1);
        header.writeUInt16BE(0, 2);

        const promises = receivers.map((receiver: string) => {
            return new Promise((resolve, reject) => {
                const sock = net.isIPv6(receiver) ? this._socket6 : this._socket;
                if (!sock) {
                    this.logger.error({
                        message: `Unable to send message to ${receiver}, no socket of correct family available`
                    });
                }
                sock?.send([header, message], this._port, receiver, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(undefined);
                    }
                });
            });
        });

        await Promise.allSettled(promises);
    }
}
export default UdpEventBus;