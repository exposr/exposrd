import crypto from 'crypto';
import os from 'os';

class Node {
    static hostname = `${process.pid}@${os.hostname}`;
    static identifier = crypto.createHash('sha1').update(`${Date.now() + Math.random()}`).digest('hex');
    static interface = Node.getNetworkInterface();

    static address4 = Node._getIP(Node.interface, 'IPv4');
    static address6 = Node._getIP(Node.interface, 'IPv6');
    static address = Node.address4 || Node.address6 || '0.0.0.0';

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