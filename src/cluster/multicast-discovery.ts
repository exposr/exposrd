import dgram from 'dgram';
import DiscoveryMethod from "./discovery-method.js";
import { Logger } from '../logger.js';

function inCidr(ipAddress: string, cidrPrefix: string): boolean {
    const [subnet, prefixLength] = cidrPrefix.split('/');
    const subnetOctets = subnet.split('.').map(Number);
    const ipOctets = ipAddress.split('.')?.map(Number);
  
    const subnetInt = (subnetOctets[0] << 24) |
                      (subnetOctets[1] << 16) |
                      (subnetOctets[2] << 8) |
                      subnetOctets[3];
  
    const ipInt = (ipOctets[0] << 24) |
                  (ipOctets[1] << 16) |
                  (ipOctets[2] << 8) |
                  ipOctets[3];

    const mask = (0xffffffff << (32 - Number.parseInt(prefixLength))) >>> 0;
  
    return (subnetInt & mask) === (ipInt & mask);
}

export type MulticastDiscoveryOptions = {
    group: string,
}

class MulticastDiscovery implements DiscoveryMethod {
    public readonly name: string;

    private _multicastgroup: string;
    private logger: any;

    constructor(opts: MulticastDiscoveryOptions) {
        this._multicastgroup = opts.group || '239.0.0.1';
        if (!inCidr(this._multicastgroup, "239.0.0.0/8")) {
            throw new Error(`${this._multicastgroup} is not within the private multicast range 239.0.0.0/8`);
        }
        this.logger = Logger('multicast-discovery');
        this.name = `multicast group ${this._multicastgroup}`;
    }

    public eligible(): number {
        return 0;
    }

    public init(socket: dgram.Socket): void {
        if (!socket) {
            this.logger.error({
                message: `Unable to initialize multicast discovery, no IPv4 socket available`
            });
            return;
        }
        socket.addMembership(this._multicastgroup);
        socket.setMulticastLoopback(true);
        this.logger.debug({
            message: `joined multicast group ${this._multicastgroup}`,
        });
    }

    public async getPeers(): Promise<Array<string>> {
        return [this._multicastgroup];
    }
}

export default MulticastDiscovery;