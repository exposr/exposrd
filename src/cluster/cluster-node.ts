import crypto from 'crypto';
import os, { NetworkInterfaceInfo } from 'os';

class Node {
    public static readonly hostname = `${process.pid}@${os.hostname}`;
    public static readonly identifier = crypto.createHash('sha1').update(`${Date.now() + Math.random()}`).digest('hex');
    public static readonly interface = Node.getNetworkInterface();

    public static readonly address4 = Node._getIP(Node.interface, 'IPv4');
    public static readonly address6 = Node._getIP(Node.interface, 'IPv6');
    public static readonly address = Node.address4 || Node.address6 || '0.0.0.0';

    public static getIP() {
        return Node._getIP(Node.interface, 'IPv4') || Node._getIP(Node.interface, 'IPv6');
    }

    private static _getIP(iface: string, family: string): string | undefined {
        const addresses = os.networkInterfaces()[iface];
        if (!addresses) {
            return undefined;
        }
        return addresses.filter((addr) => { return addr.family == family; })[0]?.address;
    }

    public static getNetworkInterface(iface?: string): string {
        const interfaces = os.networkInterfaces();

        if (iface != undefined) {
            if (interfaces[iface]) {
                return iface;
            } else {
                throw new Error('no_such_network_interface');
            }
        }

        if (Object.keys(interfaces).length == 0) {
            throw new Error('no_network_interfaces');
        }

        Object.keys(interfaces).forEach((element) => {
            const addresses = interfaces[element]?.filter(entry => !entry.internal);
            if (addresses?.length == 0) {
                delete interfaces[element];
            }
        });

        const names = Object.keys(interfaces);
        names.sort((a: string, b: string) => {

            const haveProperty = (array: Array<NetworkInterfaceInfo>, predicate: (x: NetworkInterfaceInfo) => boolean) => {
                return array.filter(predicate).length;
            }

            const score = (element: string) => {
                const addresses = interfaces[element];
                if (!addresses) {
                    return -1;
                }
                return haveProperty(addresses, (e) => {return e.family == 'IPv4'}) +
                    haveProperty(addresses, (e) => {return e.family == 'IPv6'});
            }

            return 2*score(b) - 2*score(a) - a.localeCompare(b);
        });

        return names[0];
    }
}

export default Node;