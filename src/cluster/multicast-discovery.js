function inCidr(ipAddress, cidrPrefix) {
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

    const mask = (0xffffffff << (32 - prefixLength)) >>> 0;
  
    return (subnetInt & mask) === (ipInt & mask);
}

class MulticastDiscovery {

    constructor(opts) {
        this._multicastgroup = opts.group || '239.0.0.1';
        if (!inCidr(this._multicastgroup, "239.0.0.0/8")) {
            throw new Error(`${this._multicastgroup} is not within the private multicast range 239.0.0.0/8`);
        }
        this.logger = opts.logger;
        this.name = `multicast group ${this._multicastgroup}`;
    }

    eligible() {
        return 0;
    }

    init(socket) {
        socket.addMembership(this._multicastgroup);
        socket.setMulticastLoopback(true);
        this.logger.debug({
            message: `joined multicast group ${this._multicastgroup}`,
        });
    }

    async getPeers() {
        return [this._multicastgroup];
    }
}

export default MulticastDiscovery;