import Config from './config.js';
import AdminApiController from './controller/admin-api-controller.js';
import AdminController from './controller/admin-controller.js';
import ApiController from './controller/api-controller.js';
import ClusterManager from './cluster/cluster-manager.js';
import IngressManager from './ingress/ingress-manager.js';
import { Logger } from './logger.js';
import { StorageService } from './storage/index.js';
import TransportService from './transport/transport-service.js';
import Version from './version.js';
import Node from './cluster/cluster-node.js';
import TunnelService from './tunnel/tunnel-service.js';
import TunnelConnectionManager from './tunnel/tunnel-connection-manager.js';

export default async (argv) => {
    const config = new Config(argv);
    const logger = Logger();
    logger.info(`exposrd ${Version.version.version}`);
    logger.info({
        node_id: Node.identifier,
        host: Node.hostname,
        address: Node.address,
    });

    process.on('uncaughtException', (err, origin) => {
        logger.error(`uncaughtException: ${origin} ${err.message}`);
        logger.debug(err.stack);
        process.exit(-1);
    });

    // Initialize storage and cluster service
    const storageServiceReady = new Promise((resolve, reject) => {
        try {
            const storage = new StorageService({
                callback: (err) => {
                    err ? reject(err) : resolve(storage);
                },
                url: config.get('storage-url'),
                pgsql: {
                    poolSize: config.get('storage-pgsql-connection-pool-size'),
                }
            });
        } catch (e) {
            reject(e);
        }
    });

    const clusterType = config.get('cluster');
    const clusterServiceReady = ClusterManager.init(clusterType, {
        key: config.get('cluster-key'),
        redis: {
            redisUrl: config.get('cluster-redis-url'),
        },
        udp: {
            port: config.get('cluster-udp-port'),
            discoveryMethod: config.get('cluster-udp-discovery') != 'auto' ? config.get('cluster-udp-discovery'): undefined,
            multicast: {
                group: config.get('cluster-udp-discovery-multicast-group')
            },
            kubernetes: {
                serviceNameEnv: config.get('cluster-udp-discovery-kubernetes-service-env'),
                namespaceEnv: config.get('cluster-udp-discovery-kubernetes-namespace-env'),
                serviceName: config.get('cluster-udp-discovery-kubernetes-service'),
                namespace: config.get('cluster-udp-discovery-kubernetes-namespace'),
                clusterDomain: config.get('cluster-udp-discovery-kubernetes-cluster-domain'),
            }
        }
    });

    const [storageService, _] = await Promise
        .all([
            storageServiceReady,
            clusterServiceReady
        ])
        .catch((err) => {
            logger.error(`Failed to start up: ${err.message}`);
            logger.debug(err.stack);
            process.exit(-1);
        });

    // Setup tunnel data ingress (incoming tunnel data)
    const ingressReady = IngressManager.listen({
        http: {
            enabled: config.get('ingress').includes('http'),
            port: config.get('ingress-http-port'),
            subdomainUrl: config.get('ingress-http-url'),
            httpAgentTTL: config.get('ingress-http-agent-idle-timeout'),
        },
        sni: {
            enabled: config.get('ingress').includes('sni'),
            port: config.get('ingress-sni-port'),
            host: config.get('ingress-sni-host'),
            cert: config.get('ingress-sni-cert'),
            key: config.get('ingress-sni-key'),
        }
    });

    const transportReady = new Promise((resolve, reject) => {
        try {
            // Setup tunnel transport connection endpoints (for clients to establish tunnels)
            const transport = new TransportService({
                callback: (err) => {
                    err ? reject(err) : resolve(transport);
                },
                max_connections: config.get('transport-max-connections'),
                ws: {
                  enabled: config.get('transport').includes('ws'),
                  baseUrl: config.get('api-url'),
                  port: config.get('api-port'),
                },
                ssh: {
                  enabled: config.get('transport').includes('ssh'),
                  hostKey: config.get('transport-ssh-key'),
                  host: config.get('transport-ssh-host'),
                  port: config.get('transport-ssh-port'),
                  allowInsecureTarget: config.get('transport-ssh-allow-insecure-target'),
                },
            });
        } catch (e) {
            reject(e);
        }
    });

    const adminControllerReady = new Promise((resolve, reject) => {
        const adminController = new AdminController({
            enable: config.get('admin-enable'),
            port: config.get('admin-port'),
            callback: (err) => {
                err ? reject(err) : resolve(adminController);
            },
        });
    });

    const adminApiControllerReady = new Promise((resolve, reject) => {
        const adminApiController = new AdminApiController({
            enable: config.get('admin-api-enable'),
            port: config.get('admin-api-port'),
            apiKey: config.get('admin-api-key'),
            unauthAccess: config.get('admin-api-allow-access-without-key'),
            callback: (err) => {
                err ? reject(err) : resolve(adminApiController);
            },
        });
    });

    const apiControllerReady = new Promise((resolve, reject) => {
        const apiController = new ApiController({
            port: config.get('api-port'),
            url: config.get('api-url'),
            allowRegistration: config.get('allow-registration') || false,
            callback: (err) => {
                err ? reject(err) : resolve(apiController);
            },
        });
    });

    const [
        tunnelConnectionManager,
        ingress,
        transport,
        apiController,
        adminApiController,
        adminController,
    ] = await Promise
        .all([
            TunnelConnectionManager.start(),
            ingressReady,
            transportReady,
            apiControllerReady,
            adminApiControllerReady,
            adminControllerReady,
        ])
        .catch((err) => {
            logger.error(`Failed to start up: ${err.message}`);
            logger.debug(err.stack);
            process.exit(-1);
        });

    await ClusterManager.start();
    adminController.setReady();
    logger.info("exposrd ready");

    const shutdown = async (signal, {gracefulTimeout, drainTimeout}) => {
        gracefulTimeout ??= 30000;
        drainTimeout ??= 5000;
        const startTime = process.hrtime.bigint();
        logger.info(`Shutdown initiated, signal=${signal}, press Ctrl-C again to force quit`);

        let forceListener;
        const force = new Promise((resolve, reject) => {
            forceListener = () => { reject(); };
            process.once('SIGTERM', forceListener);
            process.once('SIGINT', forceListener);
        });

        let gracefulTimer;
        const timeout = new Promise((resolve, reject) => {
            gracefulTimer = setTimeout(reject, gracefulTimeout);
        });

        let result;
        try {
            // Drain and block new tunnel connections
            await Promise.race([TunnelConnectionManager.stop() , timeout, force]);

            adminController.setReady(false);
            ClusterManager.stop();

            if (ClusterManager.isMultinode()) {
                logger.info("Waiting for connections to drain...");
                await Promise.race([new Promise((resolve) => {
                    setTimeout(resolve, drainTimeout);
                }), timeout, force]);
            }

            const destruction = Promise.allSettled([
                apiController.destroy(),
                adminApiController.destroy(),
                adminController.destroy(),
                transport.destroy(),
                IngressManager.close(),
                storageService.destroy(),
                ClusterManager.close(),
                config.destroy(),
            ]);

            await Promise.race([destruction, timeout, force]);
            result = true;
        } catch (e) {
            logger.warn('Failed to gracefully shutdown service, forcing shutdown');
            result = false;
        } finally {
            clearTimeout(gracefulTimer);
            process.removeListener('SIGTERM', forceListener);
            process.removeListener('SIGINT', forceListener);
            const elapsedMs = Math.round(Number((process.hrtime.bigint() - BigInt(startTime))) / 1e6);
            logger.info(`Shutdown complete in ${elapsedMs} ms`);
        }
        return result;
    };

    return shutdown;
}