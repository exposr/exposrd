import Config from './config.js';
import AdminController from './controller/admin-controller.js';
import ApiController from './controller/api-controller.js';
import Endpoint from './endpoint/index.js';
import Ingress from './ingress/index.js';
import Listener from './listener/index.js';
import Logger from './logger.js';
import Storage from './storage/index.js';
import Node from './utils/node.js';
import Version from './version.js';

export default async () => {
    Logger.info(`exposr-server ${Version.version.version}`);
    Logger.info({
        node_id: Node.identifier,
        host: Node.hostname,
        address: Node.address,
    })

    let listener;
    let endpoint;
    let ingress;
    try {
        // Setup listeners
        listener = new Listener({
            http: {
              port: Config.get('port')
            }
      });

      // Setup tunnel connection endpoints (for clients to establish tunnels)
      endpoint = new Endpoint({
          ws: {
            enabled: true,
            baseUrl: Config.get('api-url')
          }
      });

    // Setup tunnel data ingress (incoming tunnel data)
      ingress = new Ingress({
          http: {
              enabled: Config.get('ingress').includes('http'),
              subdomainUrl: Config.get('http-ingress-domain')
          }
      });
    } catch (err) {
        Logger.error(err.message);
        process.exit(-1);
    }

    const adminController = Config.get('admin-enable') ? new AdminController(Config.get('admin-port')) : undefined;
    const apiController = new ApiController();

    const redisProbe = new Promise((resolve, reject) => {
        try {
            new Storage("default", { callback: resolve });
        } catch (e) {
            reject(e);
        }
    })

    await Promise
        .all([
            listener.listen(),
            redisProbe,
        ])
        .catch((err) => {
            Logger.error(`Failed to start up: ${err.message}`);
            process.exit(-1);
        });

    if (adminController) {
        Logger.info({
            message: "Admin interface enabled",
            port: Config.get('admin-port')
        });
        adminController.setReady();
    } else {
        Logger.info({message: "Admin interface disabled"});
    }

    Logger.info({
        message: "API endpoint",
        base_url: Config.get('api-url'),
        port: Config.get('port')
    });
    Logger.info("exposr-server ready");

    const sigHandler = async (signal) => {
        Logger.info(`Shutdown initiated, signal=${signal}`)

        await listener.destroy();
        await endpoint.destroy();
        await ingress.destroy();
        await apiController.destroy();
        adminController && await adminController.destroy();
        Logger.info(`Shutdown complete`)
        process.exit(0);
    };

    process.on('SIGTERM', sigHandler);
    process.on('SIGINT', sigHandler);
}