import crypto from 'crypto';
import NodeCache from 'node-cache';
import os from 'os';
import Storage from '../storage/index.js';

class Node {
    static hostname = `${process.pid}@${os.hostname}`;
    static identifier = crypto.createHash('sha1').update(Node.hostname).digest('hex');
    static interface = Node.getNetworkInterface();

    static address4 = Node._getIP(Node.interface, 'IPv4');
    static address6 = Node._getIP(Node.interface, 'IPv6');
    static address = Node.address4 || Node.address6;

    static getIP() {
        return Node._getIP(Node.interface, 'IPv4') || Node._getIP(Node.interface, 'IPv6');
    }

    static _getIP(iface, family) {
        const addresses = os.networkInterfaces()[iface];
        if (!addresses) {
            return undefined;
        }
        return addresses.filter((addr) => { return addr.family == family; })[0]?.address;
    }

    static getNetworkInterface(iface) {
        const interfaces = os.networkInterfaces();

        if (iface != undefined && interfaces[iface]) {
            return iface;
        }

        Object.keys(interfaces).forEach((element) => {
            const addresses = interfaces[element].filter(entry => !entry.internal);
            if (addresses.length == 0) {
                delete interfaces[element];
            }
        });

        const names = Object.keys(interfaces);
        names.sort((a, b) => {

            const haveProperty = (array, predicate) => {
                return array.filter(predicate).length;
            }

            const score = (element) => {
                const addresses = interfaces[element];
                return haveProperty(addresses, (e) => {return e.family == 'IPv4'}) +
                    haveProperty(addresses, (e) => {return e.family == 'IPv6'});
            }

            return 2*score(b) - 2*score(a) - a.localeCompare(b);
        });

        return names[0];
    }
}

export default Node;
class NodeService {
    constructor() {
        if (NodeService.instance instanceof NodeService) {
            NodeService.ref++;
            return NodeService.instance;
        }
        NodeService.instance = this;
        NodeService.ref = 1;
        this._storage = new Storage("node");

        const reportNode = async () => {
            const obj = {
                ...await this.get(),
                _ts: new Date().getTime(),
            }
            return this._storage.set(Node.identifier, obj, { TTL: 120 });
        };

        this._reporter = setInterval(reportNode, 60000);
        setTimeout(reportNode, 10);

        this._peerCache = new NodeCache({
            useClones: false,
            deleteOnExpire: true,
        });
    }

    async destroy() {
        if (--NodeService.ref == 0) {
            clearInterval(this._reporter);
            delete this._reporter;
            delete NodeService.instance;
            return this._storage.destroy();
        }
    }

    async get(id) {
        if (id == undefined) {
            return {
                id: Node.identifier,
                host: Node.hostname,
                address: Node.getIP(),
            }
        }

        let peer;
        peer = this._peerCache.get(id);
        if (peer == undefined) {
            peer = await this._storage.get(id);
            if (peer) {
                this._peerCache.set(id, peer, 60);
            }
        }
        return peer;
    }
}

export { NodeService };
