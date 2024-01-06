import fs from 'fs';
import dns from 'dns/promises';
import { Logger } from '../logger.js';
import DiscoveryMethod from './discovery-method.js';
import ClusterManager from './cluster-manager.js';

export type KubernetesDiscoveryOptions = {
    serviceNameEnv?: string,
    namespaceEnv?: string,
    serviceName?: string,
    namespace?: string,
    clusterDomain?: string,
}

class KubernetesDiscovery implements DiscoveryMethod {
    public readonly name: string;

    private logger: any;
    private _serviceName: string;
    private _namespace: string;
    private _clusterDomain: string;
    private _serviceHost: string;
    private _cacheTime: number;
    private _cachedPeers: Array<string> | undefined;

    constructor(opts: KubernetesDiscoveryOptions) {
        this.logger = Logger("kubernetes-discovery");

        const serviceNameEnv = opts?.serviceNameEnv || 'SERVICE_NAME';
        const namespaceEnv = opts?.namespaceEnv || 'POD_NAMESPACE';

        this._serviceName = opts?.serviceName || process.env[serviceNameEnv] || "exposr-headless";
        this._namespace = opts?.namespace || process.env[namespaceEnv] || "default";
        this._clusterDomain = opts?.clusterDomain || 'cluster.local';

        this._serviceHost = `${this._serviceName}.${this._namespace}.svc.${this._clusterDomain}`;

        this.name = `kubernetes service ${this._serviceHost}`;
        this._cacheTime = Date.now() - 1000;
    }

    public eligible(): number {
        const namespaceFile = '/var/run/secrets/kubernetes.io/serviceaccount/namespace';

        if (!fs.existsSync(namespaceFile)) {
            this.logger.debug({
                message: `${namespaceFile} does not exist`,
            });
            return -1;
        }

        return 10;
    }

    public init(): void {
        this.logger.debug({
            message: `using ${this._serviceHost} headless service for pod discovery`,
        });
    }

    public async getPeers(): Promise<Array<string>> {
        if (this._cachedPeers && (Date.now() - this._cacheTime) < 1000) {
            return this._cachedPeers;
        }

        let peers: Array<string> = [];
        try {
            peers = await this._resolvePeers();
            this._cachedPeers = peers;
            this._cacheTime = Date.now();
        } catch (err: any) {
            this.logger.warn({
                message: `failed to resolve ${this._serviceHost}: ${err.message}`
            });
        }

        const learntPeers = ClusterManager.getLearntPeers();
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
            } else if (result4.status == 'rejected') {
                throw result4.reason;
            } else if (result6.status == 'rejected') {
                throw result6.reason;
            } else {
                throw new Error('unknown');
            }
        });
    }
}

export default KubernetesDiscovery;
