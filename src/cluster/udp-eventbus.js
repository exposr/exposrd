import assert from 'assert/strict';
import dgram from 'dgram';
import net from 'net';
import { Logger } from '../logger.js';
import MulticastDiscovery from './multicast-discovery.js';
import KubernetesDiscovery from './kubernetes-discovery.js';

class UdpEventBus {

    constructor(opts) {
        this.logger = Logger("udp-eventbus");

        this._port = opts.port || 1025;

        try {
            this._discoveryMethods = {
                multicast: new MulticastDiscovery({
                    logger: this.logger,
                    ...opts.multicast,
                }),
                kubernetes: new KubernetesDiscovery({
                    logger: this.logger,
                    ...opts.kubernetes
                }),
            };
        } catch (e) {
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

        assert(this._discoveryMethod != undefined);
        assert(opts.handler != undefined);

        const onMessage = (data, rinfo) => {
            if (data.length <= 5) {
                return;
            }

            const header = new Uint8Array(data.buffer.slice(0, 4));
            const msg = Buffer.from(data.buffer.slice(4));

            if (!(header[0] == 0xE0 && header[1] == 0x05)) {
                return;
            }

            opts.handler(msg.toString('utf-8'));
        };

        const createSocket = (type) => {
            return new Promise((resolve, reject) => {
                const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
                sock.on('message', onMessage);

                const connectError = (err) => {
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
            if (!this._socket && !this._socket6) {
                typeof opts.callback === 'function' && process.nextTick(() => { opts.callback(result4.reason) });
                return;
            }

            this._discoveryMethod.init(this._socket, this._socket6);
            this.logger.info({
                message: `Cluster interface on ${this._port} (${mode}) using discovery method ${this._discoveryMethod.name}`,
            });
            typeof opts.callback === 'function' && process.nextTick(opts.callback);
        });
    }

    async destroy() {
        return Promise.allSettled([
            new Promise((resolve, reject) => {
                if (this._socket) {
                    this._socket.close(resolve);
                } else {
                    resolve();
                }
            }),
            new Promise((resolve, reject) => {
                if (this._socket6) {
                    this._socket6.close(resolve);
                } else {
                    resolve();
                }
            })
        ])
    }

    async publish(message) {
        this._receivers = await this._discoveryMethod.getPeers();

        const header = Buffer.allocUnsafe(4);
        header.writeUInt8(0xE0, 0);
        header.writeUInt8(0x05, 1);
        header.writeUInt16BE(0, 2);

        const promises = this._receivers.map((receiver) => {
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
                        resolve();
                    }
                });
            });
        });

        return Promise.allSettled(promises);
    }
}
export default UdpEventBus;