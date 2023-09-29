import { Duplex } from "stream";
import { Socket, TcpSocketConnectOpts } from "net";
import Transport, { TransportConnectionOptions, TransportOptions } from "../transport.js";
import ClusterService from "../../cluster/index.js";

export interface ClusterTransportOptions extends TransportOptions {
    nodeId: string,
}

export default class ClusterTransport extends Transport {
    private nodeId: string;
    private clusterService: ClusterService;
    constructor(opts: ClusterTransportOptions) {
        super(opts);
        this.nodeId = opts.nodeId;
        this.clusterService = new ClusterService();
    }

    public createConnection(opts: TransportConnectionOptions, callback: (err: Error | undefined, sock: Duplex) => void): Duplex {
        const clusterNode = this.clusterService.getNode(this.nodeId);
        const sock = new Socket();
        if (!clusterNode) {
            sock.destroy(new Error('node_does_not_exist'));
            return sock;
        }

        const socketOpts: TcpSocketConnectOpts = {
            host: clusterNode.ip,
            port: opts.port || 0,
        };

        const errorHandler = (err: Error) => {
            callback(err, sock);
        };
        sock.once('error', errorHandler); 
        sock.connect(socketOpts, () => {
            sock.off('error', errorHandler);
            callback(undefined, sock);
        });
        return sock;
    }

    protected async _destroy(): Promise<void> {
        await this.clusterService.destroy();
    }
}