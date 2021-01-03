import Logger from './logger.js';
import Config from './config.js';
import TunnelServer from './tunnel-server.js';
import AdminServer from './admin-server.js';
import Listener from './listener/index.js';

export default () => { 
  Logger.info("Untitled Tunnel Project");

  const listener = new Listener({
    http: {
      port: Config.get('port')
    }
  });

  const adminServer = Config.get('enable-admin') ? new AdminServer(Config.get('admin-port')) : undefined;
  const tunnelServer = new TunnelServer({
      subdomainUrl: Config.get('subdomain-url'),
      port: Config.get('port'),
  });
  listener.listen((err) => {
    if (err === undefined) {
      if (adminServer) {
        adminServer.setReady();
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
    tunnelServer.shutdown(() => {});
    listener.shutdown(() => {
      Logger.info(`Shutdown complete`)
      process.exit(0);
    });
  };
  
  process.on('SIGTERM', sigHandler);
  process.on('SIGINT', sigHandler);
}