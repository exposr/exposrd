import { Socket } from 'net';

class NodeSocket extends Socket {
    constructor(opts) {
        super();
        const {tunnelId, node, port} = opts;
        this._tunnelId = tunnelId;
        this._node = node;
        this._port = port;
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
        return `<${NodeSocket.name} tunnel=${this._tunnelId} target=${this._node.id}>`;
    }

    async _doConnect(callback) {
        this._canonicalConnect({
            host: this._node.ip,
            port: this._port,
            setDefaultEncoding: 'binary'
        }, () => {
            typeof callback ==='function' && callback();
        });
    }
}

export default NodeSocket;