import dgram from 'dgram';
import { Logger } from '../logger.js';

class UdpEventBus {

    constructor(opts) {
        this.logger = Logger("udp-eventbus");

        this._port = opts.port || 1025;
        this._multicastgroup = opts.group || '239.0.0.1';

        this._socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        this._socket.on('message', (data, rinfo) => {
            if (data.length <= 5) {
                return;
            }

            const header = new Uint8Array(data.buffer.slice(0, 4));
            const msg = Buffer.from(data.buffer.slice(4));

            if (!(header[0] == 0xE0 && header[1] == 0x05)) {
                return;
            }

            opts.handler(msg.toString('utf-8'));
        });

        const connectError = (err) => {
            this._socket.close();
            typeof opts.callback === 'function' && process.nextTick(() => opts.callback(err));
        };

        this._socket.once('error', connectError);
        this._socket.bind(this._port, () => {
            this._socket.addMembership(this._multicastgroup);
            this._socket.setMulticastLoopback(true);
            this.logger.info({
                message: `joined multicast group ${this._multicastgroup}:${this._port}`,
            });
            this._socket.removeListener('error', connectError);
            typeof opts.callback === 'function' && process.nextTick(opts.callback);
        });
    }

    async destroy() {
        return new Promise((resolve, reject) => {
            this._socket.close(resolve);
        });
    }

    async publish(message) {
        this._receivers = [this._multicastgroup];

        const header = Buffer.allocUnsafe(4);
        header.writeUInt8(0xE0, 0);
        header.writeUInt8(0x05, 1);
        header.writeUInt16BE(0, 2);

        const promises = this._receivers.map((receiver) => {
            return new Promise((resolve, reject) => {
                this._socket.send([header, message], this._port, receiver, (err) => {
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