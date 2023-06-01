import fs from 'fs';
import dns from 'dns/promises';
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

        this._getLearntPeers = opts.getLearntPeers;

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
        const peers = await this._resolvePeers()
            .then((p) => {
                this._cachedPeers = p;
                this._cacheTime = Date.now();
                return p;
            })
            .catch((err) => {
                this.logger.warn({
                    message: `failed to resolve ${this._serviceHost}: ${err.message}`
                });
                return [];
            });

        const learntPeers = this._getLearntPeers();
        for (let i = 0; i < learntPeers.length; i++) {
            if (peers.indexOf(learntPeers[i]) === -1) {
                peers.push(learntPeers[i]);
            }
        }

        return peers;
    }

    async _resolvePeers() {
        return Promise.allSettled([
            dns.resolve4(this._serviceHost),
            dns.resolve6(this._serviceHost)
        ]).then((results) => {
            const [result4, result6] = results;
            if (result4.status == 'fulfilled' && result4.value?.length > 0) {
                return result4.value;
            } else if (result6.status == 'fulfilled' && result6.value?.length > 0) {
                return result6.value;
            } else {
                throw result4?.reason || result6?.reason || new Error('unknown');
            }
        });
    }
}

export default KubernetesDiscovery;
