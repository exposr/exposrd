import fs from 'fs';
import dns from 'dns';
import { Logger } from '../logger.js';

class KubernetesDiscovery {
    constructor(opts) {
        this.logger = opts?.logger || Logger("kubernetes-discovery");

        const serviceNameEnv = opts?.serviceNameEnv || 'SERVICE_NAME';
        const namespaceEnv = opts?.namespaceEnv || 'POD_NAMESPACE';

        this._serviceName = opts?.serviceName || process.env[serviceNameEnv] || "exposr-headless"; 
        this._namespace = opts?.namespace || process.env[namespaceEnv] || "default";
        this._clusterDomain = opts?.clusterDomain || 'cluster.local';

        this._serviceHost = `${this._serviceName}.${this._namespace}.svc.${this._clusterDomain}`;

        this.name = `kubernetes service ${this._serviceHost}`;
        this._cacheTime = Date.now() - 1000;
    }

    eligible() {
        const namespaceFile = '/var/run/secrets/kubernetes.io/serviceaccount/namespace';

        if (!fs.existsSync(namespaceFile)) {
            this.logger.debug({
                message: `${namespaceFile} does not exist`,
            });
            return -1;
        }

        return 10;
    }

    init() {
        this.logger.debug({
            message: `using ${this._serviceHost} headless service for pod discovery`,
        });
    }

    async getPeers() {
        if (this._cachedPeers && (Date.now() - this._cacheTime) < 1000) {
            return this._cachedPeers;
        }
        const peers = await this._resolvePeers();
        this._cachedPeers = peers;
        this._cacheTime = Date.now();
        return peers;
    }

    _resolvePeers() {
        return new Promise((resolve, reject) => {
            dns.resolve4(this._serviceHost, (err, addresses) => {
                if (err) {
                    reject(err);
                    return;
                }

                resolve(addresses);
            });
        });
    }
}

export default KubernetesDiscovery;
