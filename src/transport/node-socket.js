import { Socket } from 'net';
import Node from '../cluster/cluster-node.js';
import ClusterService from '../cluster/index.js';
import { Logger } from '../logger.js';

class NodeSocket extends Socket {
    constructor(opts) {
        super();
        this.logger = Logger("node-socket");
        this._opts = opts;
        this._clusterService = new ClusterService();
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
        await this._clusterService.destroy();
    }

    static createConnection(opts, callback) {
        const sock = new NodeSocket(opts);
        sock.connect({}, callback);
        return sock;
    }

    toString() {
        return `<${NodeSocket.name} tunnel=${this._opts.tunnelId} target=${this._opts.node}>`;
    }

    async _doConnect(callback) {

        const closeSock = () => {
            this.destroy();
        };

        const nextNode = this._clusterService.getNode(this._opts.node);
        if (!nextNode) {
            return closeSock();
        }

        this.nextNode = nextNode;
        if (nextNode.id == Node.identifier) {
            return closeSock();
        }

        this.logger.isDebugEnabled() && this.logger.withContext('tunnel', this._opts.tunnelId).debug({
            operation: 'connection-redirect',
            next: nextNode.id,
            ip: nextNode.ip,
            port: this._opts.port,
        });

        this._canonicalConnect({
            host: nextNode.ip,
            port: this._opts.port,
            setDefaultEncoding: 'binary'
        }, () => {
            typeof callback ==='function' && callback();
        });
    }
}

export default NodeSocket;