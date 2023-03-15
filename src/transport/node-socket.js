import { Socket } from 'net';
import { Logger } from '../logger.js';
import TunnelService from '../tunnel/tunnel-service.js';
import Tunnel from '../tunnel/tunnel.js';
import Node, { NodeService } from '../utils/node.js';

class NodeSocket extends Socket {
    constructor(opts) {
        super();
        this.logger = Logger("tunnel-service");
        this._opts = opts;
        this._tunnelService = new TunnelService();
        this._canonicalConnect = this.connect;
        this.connect = (_opt, callback) => {
            this.connecting = true;
            setImmediate(async () => {
                this._doConnect(callback);
            })
        };
    }

    async destroy() {
        super.destroy();
        return this._tunnelService.destroy();
    }

    static createConnection(opts, callback) {
        const sock = new NodeSocket(opts);
        sock.connect({}, callback);
        return sock;
    }

    toString() {
        return `<${NodeSocket.name} tunnel=${this._opts.tunnelId} target=${this?.nextNode?.id}>`;
    }

    async _doConnect(callback) {

        const closeSock = () => {
            this.destroy();
        };

        const tunnel = await this._tunnelService.lookup(this._opts.tunnelId);
        if (!(tunnel instanceof Tunnel)) {
            return closeSock();
        }

        const nodeService = new NodeService();
        const nextNode = await nodeService.get(tunnel.state().node);
        nodeService.destroy();
        if (!nextNode) {
            return closeSock();
        }

        if (nextNode.id == Node.identifier) {
            return closeSock();
        }

        this.nextNode = nextNode;
        this.logger.isDebugEnabled() && this.logger.withContext('tunnel', this._opts.tunnelId).debug({
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