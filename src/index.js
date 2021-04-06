import Logger from './logger.js';
import Config from './config.js';
import ApiController from './controller/api-controller.js';
import AdminController from './controller/admin-controller.js';
import Listener from './listener/index.js';
import Ingress from './ingress/index.js';
import Endpoint from './endpoint/index.js';

export default () => {
    Logger.info("Untitled Tunnel Project");

    // Setup listeners
    const listener = new Listener({
        http: {
          port: Config.get('port')
        }
    });

    // Setup tunnel connection endpoints (for clients to establish tunnels)
    const endpoint = new Endpoint({
      ws: {
        enabled: true,
        baseUrl: Config.get('base-url')
      }
    });

    // Setup tunnel data ingress (incoming tunnel data)
    const ingress = new Ingress({
      http: {
        enabled: Config.get('ingress').includes('http'),
        subdomainUrl: Config.get('http-ingress-domain')
      }
    });

    const adminController = Config.get('enable-admin') ? new AdminController(Config.get('admin-port')) : undefined;
    const apiController = new ApiController();

    listener.listen((err) => {
        if (err === undefined) {
          if (adminController) {
              adminController.setReady();
              Logger.info({
                  message: "Admin interface enabled",
                  port: Config.get('admin-port')
              });
          } else {
              Logger.info({message: "Admin interface disabled"});
          }
          Logger.info({
              message: "Ready",
              subdomain_url: Config.get('subdomain-url'),
              port: Config.get('port')
          });
        }
    });

    const sigHandler = (signal) => {
        Logger.info(`Shutdown initiated, signal=${signal}`)
        apiController.shutdown(() => {});
        listener.shutdown(() => {
            Logger.info(`Shutdown complete`)
            process.exit(0);
        });
    };

    process.on('SIGTERM', sigHandler);
    process.on('SIGINT', sigHandler);
}