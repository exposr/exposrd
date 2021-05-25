import { Socket } from 'net';
import { Logger } from '../logger.js';
import TunnelService from '../tunnel/tunnel-service.js';
import Tunnel from '../tunnel/tunnel.js';
import Node from '../utils/node.js';

const logger = Logger("tunnel-service");

class NodeSocket extends Socket {
    constructor(opts) {
        super();
        this._opts = opts;
        this._tunnelService = opts.tunnelService || new TunnelService();
        this._canonicalConnect = this.connect;
        this.connect = (_opt, callback) => {
            this.connecting = true;
            setImmediate(async () => {
                this._doConnect(callback);
            })
        };
    }

    static createConnection(opts, callback) {
        const sock = new NodeSocket(opts);
        sock.connect({}, callback);
        return sock;
    }

    toString() {
        return `<${NodeSocket.name} tunnel=${this._opts.tunnelId}>`;
    }

    async _doConnect(callback) {

        const closeSock = () => {
            this.destroy();
        };

        const tunnel = await this._tunnelService.lookup(this._opts.tunnelId);
        if (!(tunnel instanceof Tunnel)) {
            return closeSock();
        }

        const nextNode = await Node.get(tunnel.state().node);
        if (!nextNode) {
            return closeSock();
        }

        if (nextNode.id == Node.identifier) {
            return closeSock();
        }

        logger.isDebugEnabled() && logger.withContext('tunnel', this._opts.tunnelId).debug({
            operation: 'connection-redirect',
            next: nextNode,
        });

        this._canonicalConnect({
            host: nextNode.address,
            port: this._opts.port,
            setDefaultEncoding: 'binary'
        }, () => {
            typeof callback ==='function' && callback();
        });
    }
}

export default NodeSocket;