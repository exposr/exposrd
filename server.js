import Config from './config.js';
import TunnelServer from './tunnel-server.js';
import AdminServer from './admin-server.js';

const adminServer = Config.get('enable-admin') ? new AdminServer(Config.get('admin-port')) : undefined;
const tunnelServer = new TunnelServer({
    subdomainUrl: Config.get('subdomain-url'),
    port: Config.get('port'),
});
tunnelServer.listen((err) => {
  if (err === undefined) {
    adminServer && adminServer.setReady();
  }
});

const sigHandler = (signal) => {
  tunnelServer.shutdown((err) => {
    process.exit(0);
  });
};

process.on('SIGTERM', sigHandler);
process.on('SIGINT', sigHandler);