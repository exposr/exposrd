import yargs from 'yargs';
import { URL } from 'url';
import TunnelServer from './tunnel-server.js';

const argv = yargs.command('$0 <subdomain-url>', '', (yargs) => {
    yargs
      .positional('subdomain-url', {
        describe: 'Subdomain hostname used for tunnels, ex. https://example.com'
      })
  }, (argv) => {})
  .option('port', {
    alias: 'p',
    type: 'number',
    default: 8080,
    description: 'Port to listen on'
  })
  .argv

  const parseUrl = (url) => {
    try {
        return new URL(url);
    } catch (err) {
        console.log(err.message);
        process.exit(-1);
    }
};

const tunnelServer = new TunnelServer({
    subdomainUrl: parseUrl(argv['subdomain-url']),
    port: argv['port'],
});
tunnelServer.listen(argv['port']);

const sigHandler = (signal) => {
  tunnelServer.shutdown((err) => {
    process.exit(0);
  });
};

process.on('SIGTERM', sigHandler);
process.on('SIGINT', sigHandler);