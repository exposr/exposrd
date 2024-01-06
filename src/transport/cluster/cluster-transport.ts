import { Duplex } from "stream";
import tls from "tls";
import net from "net";
import Transport, { TransportConnectionOptions, TransportOptions } from "../transport.js";
import ClusterManager from "../../cluster/cluster-manager.js";

export interface ClusterTransportOptions extends TransportOptions {
    nodeId: string,
}

export default class ClusterTransport extends Transport {
    private nodeId: string;
    constructor(opts: ClusterTransportOptions) {
        super(opts);
        this.nodeId = opts.nodeId;
    }

    public createConnection(opts: TransportConnectionOptions, callback: (err: Error | undefined, sock: Duplex) => void): Duplex {

        const clusterNode = ClusterManager.getNode(this.nodeId);
        if (!clusterNode) {
            const sock = new net.Socket();
            sock.destroy(new Error('node_does_not_exist'));
            return sock;
        }

        let sock: tls.TLSSocket | net.Socket;

        const errorHandler = (err: Error) => {
            callback(err, sock);
        };

        if (opts.tls?.enabled == true) {
            const tlsConnectOpts: tls.ConnectionOptions = {
                servername: opts.tls.servername,
                host: clusterNode.ip,
                port: opts.port || 0,
                ca: [
                    <any>opts.tls?.cert?.toString(),
                    ...tls.rootCertificates,
                ],
            };
            sock = tls.connect(tlsConnectOpts, () => {
                sock.off('error', errorHandler);
                callback(undefined, sock);
            });
            sock.once('error', errorHandler);
        } else {
            const socketConnectOpts: net.TcpSocketConnectOpts = {
                host: clusterNode.ip,
                port: opts.port || 0,
            };
            sock = net.connect(socketConnectOpts, () => {
                sock.off('error', errorHandler);
                callback(undefined, sock);
            });
            sock.once('error', errorHandler);
        }

        return sock;
    }

    protected async _destroy(): Promise<void> {
    }
}