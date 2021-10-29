import Config from './config.js';
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
    Logger.info(`exposr-server ${Version.version.version}`);
    Logger.info({
        node_id: Node.identifier,
        host: Node.hostname,
        address: Node.address,
    });

    process.on('uncaughtException', (err, origin) => {
        Logger.error(`uncaughtException: ${err.message}`);
        Logger.debug(err.stack);
        process.exit(-1);
    });

    // Initialize storage and eventbus
    const storageServiceReady = new Promise((resolve, reject) => {
        try {
            const mode = Config.get('redis-url') ? 'redis' : 'mem';

            const storage = new StorageService(mode, {
                callback: (err) => {
                    err ? reject(err) : resolve(storage);
                },
                redisUrl: Config.get('redis-url'),
            });
        } catch (e) {
            reject(e);
        }
    });

    const eventBusServiceReady = new Promise((resolve, reject) => {
        try {
            const mode = Config.get('redis-url') ? 'redis' : 'mem';

            const eventBusService = new EventBusService(mode, {
                callback: (err) => {
                    err ? reject(err) : resolve(eventBusService);
                },
                redisUrl: Config.get('redis-url'),
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
                  enabled: Config.get('transport').includes('ws'),
                  baseUrl: Config.get('api-url'),
                  port: Config.get('api-port'),
                },
                ssh: {
                  enabled: Config.get('transport').includes('ssh'),
                  hostKey: Config.get('transport-ssh-key'),
                  host: Config.get('transport-ssh-host'),
                  port: Config.get('transport-ssh-port'),
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
                    enabled: Config.get('ingress').includes('http'),
                    port: Config.get('ingress-http-port'),
                    subdomainUrl: Config.get('ingress-http-domain')
                },
                sni: {
                    enabled: Config.get('ingress').includes('sni'),
                    port: Config.get('ingress-sni-port'),
                    host: Config.get('ingress-sni-host'),
                    cert: Config.get('ingress-sni-cert'),
                    key: Config.get('ingress-sni-key'),
                }
            });
        } catch (e) {
            reject(e);
        }
    });

    const adminControllerReady = new Promise((resolve, reject) => {
        const adminController = new AdminController({
            enable: Config.get('admin-enable'),
            port: Config.get('admin-port'),
            apiKey: Config.get('admin-api-key'),
            unauthAccess: Config.get('admin-allow-access-without-api-key'),
            callback: (err) => {
                err ? reject(err) : resolve(adminController);
            },
        });
    });

    const apiControllerReady = new Promise((resolve, reject) => {
        const apiController = new ApiController({
            port: Config.get('api-port'),
            url: Config.get('api-url'),
            allowRegistration: Config.get('allow-registration') || false,
            callback: (err) => {
                err ? reject(err) : resolve(apiController);
            },
        });
    });

    const [
        ingress,
        transport,
        apiController,
        adminController,
    ] = await Promise
        .all([
            ingressReady,
            transportReady,
            apiControllerReady,
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
        Logger.info(`Shutdown initiated, signal=${signal}`)

        await Promise.allSettled([
            apiController.destroy(),
            adminController.destroy(),
            transport.destroy(),
            ingress.destroy(),
            nodeService.destroy(),
            storageService.destroy(),
            eventBusService.destroy()
        ]);
        Logger.info(`Shutdown complete`)
        process.exit(0);
    };

    process.on('SIGTERM', sigHandler);
    process.on('SIGINT', sigHandler);
}