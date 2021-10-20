import Config from './config.js';
import AdminController from './controller/admin-controller.js';
import ApiController from './controller/api-controller.js';
import Ingress from './ingress/index.js';
import Logger from './logger.js';
import Storage from './storage/index.js';
import TransportService from './transport/transport-service.js';
import Node from './utils/node.js';
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
        process.exit(-1);
    });

    let transport;
    try {
        // Setup tunnel transport connection endpoints (for clients to establish tunnels)
        transport = new TransportService({
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
    } catch (err) {
        Logger.error(err.message);
        Logger.debug(err.stack);
        process.exit(-1);
    }

    const adminController = Config.get('admin-enable') ? new AdminController(Config.get('admin-port')) : undefined;
    const apiController = new ApiController({
        port: Config.get('api-port'),
        url: Config.get('api-url'),
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

    const storageReady = new Promise((resolve, reject) => {
        try {
            new Storage("default", { callback: resolve });
        } catch (e) {
            reject(e);
        }
    });

    const res = await Promise
        .all([
            storageReady,
            ingressReady,
            adminController ? adminController.listen() : new Promise((r) => r())
        ])
        .catch((err) => {
            Logger.error(`Failed to start up: ${err.message}`);
            process.exit(-1);
        });

    const ingress = res[1];

    if (adminController) {
        Logger.info({
            message: "Admin interface enabled",
            port: Config.get('admin-port')
        });
        adminController.setReady();
    } else {
        Logger.info({message: "Admin interface disabled"});
    }

    Logger.info("exposr-server ready");

    const sigHandler = async (signal) => {
        Logger.info(`Shutdown initiated, signal=${signal}`)

        await transport.destroy();
        await ingress.destroy();
        await apiController.destroy();
        adminController && await adminController.destroy();
        Logger.info(`Shutdown complete`)
        process.exit(0);
    };

    process.on('SIGTERM', sigHandler);
    process.on('SIGINT', sigHandler);
}