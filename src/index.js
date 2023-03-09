import Config from './config.js';
import AdminApiController from './controller/admin-api-controller.js';
import AdminController from './controller/admin-controller.js';
import ApiController from './controller/api-controller.js';
import { EventBusService } from './eventbus/index.js';
import Ingress from './ingress/index.js';
import Logger from './logger.js';
import { StorageService } from './storage/index.js';
import TransportService from './transport/transport-service.js';
import Node, { NodeService } from './utils/node.js';
import Version from './version.js';

export default async () => {
    const config = new Config();
    Logger.info(`exposr-server ${Version.version.version}`);
    Logger.info({
        node_id: Node.identifier,
        host: Node.hostname,
        address: Node.address,
    });

    process.on('uncaughtException', (err, origin) => {
        Logger.error(`uncaughtException: ${origin} ${err.message}`);
        Logger.debug(err.stack);
        process.exit(-1);
    });

    // Initialize storage and eventbus
    const storageServiceReady = new Promise((resolve, reject) => {
        try {
            const mode = config.get('redis-url') ? 'redis' : 'mem';

            const storage = new StorageService(mode, {
                callback: (err) => {
                    err ? reject(err) : resolve(storage);
                },
                redisUrl: config.get('redis-url'),
            });
        } catch (e) {
            reject(e);
        }
    });

    const eventBusServiceReady = new Promise((resolve, reject) => {
        try {
            const mode = config.get('redis-url') ? 'redis' : 'mem';

            const eventBusService = new EventBusService(mode, {
                callback: (err) => {
                    err ? reject(err) : resolve(eventBusService);
                },
                redisUrl: config.get('redis-url'),
            });
        } catch (e) {
            reject(e);
        }
    });

    const [storageService, eventBusService] = await Promise
        .all([
            storageServiceReady,
            eventBusServiceReady
        ])
        .catch((err) => {
            Logger.error(`Failed to start up: ${err.message}`);
            process.exit(-1);
        });

    const nodeService = new NodeService();

    const transportReady = new Promise((resolve, reject) => {
        try {
            // Setup tunnel transport connection endpoints (for clients to establish tunnels)
            const transport = new TransportService({
                callback: (err) => {
                    err ? reject(err) : resolve(transport);
                },
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
                },
            });
        } catch (e) {
            reject(e);
        }
    });

    // Setup tunnel data ingress (incoming tunnel data)
    const ingressReady = new Promise((resolve, reject) => {
        try {
            const ingress = new Ingress({
                callback: (err) => {
                    err ? reject(err) : resolve(ingress);
                },
                http: {
                    enabled: config.get('ingress').includes('http'),
                    port: config.get('ingress-http-port'),
                    subdomainUrl: config.get('ingress-http-domain')
                },
                sni: {
                    enabled: config.get('ingress').includes('sni'),
                    port: config.get('ingress-sni-port'),
                    host: config.get('ingress-sni-host'),
                    cert: config.get('ingress-sni-cert'),
                    key: config.get('ingress-sni-key'),
                }
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
        ingress,
        transport,
        apiController,
        adminApiController,
        adminController,
    ] = await Promise
        .all([
            ingressReady,
            transportReady,
            apiControllerReady,
            adminApiControllerReady,
            adminControllerReady,
        ])
        .catch((err) => {
            Logger.error(`Failed to start up: ${err.message}`);
            Logger.debug(err.stack);
            process.exit(-1);
        });

    adminController.setReady();
    Logger.info("exposr-server ready");

    const sigHandler = async (signal) => {
        const gracefulTimeout = 10000;
        const startTime = process.hrtime.bigint();
        Logger.info(`Shutdown initiated, signal=${signal}, press Ctrl-C again to force quit`);

        const graceful = await new Promise(async (resolve, reject) => {
            process.once('SIGTERM', () => { resolve(false); });
            process.once('SIGINT', () => { resolve(false); });
            const timeout = setTimeout(() => {
                resolve(false);
            }, gracefulTimeout);
            await Promise.allSettled([
                apiController.destroy(),
                adminApiController.destroy(),
                adminController.destroy(),
                transport.destroy(),
                ingress.destroy(),
                nodeService.destroy(),
                storageService.destroy(),
                eventBusService.destroy()
            ]);
            clearTimeout(timeout);
            resolve(true);
        });

        const elapsedMs = Math.round(Number((process.hrtime.bigint() - BigInt(startTime))) / 1e6);
        if (!graceful) {
            Logger.warn('Failed to gracefully shutdown service, forcing shutdown');
        }
        Logger.info(`Shutdown complete in ${elapsedMs} ms`);
        process.exit(graceful ? 0 : -1);
    };

    process.once('SIGTERM', sigHandler);
    process.once('SIGINT', sigHandler);
}