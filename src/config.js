import yargs from 'yargs';
import fs from 'fs';
import Version from './version.js';

const parse = (args = {}) => {
    const version = Version.version;
    let versionStr = `version: ${version.version} (pkg ${version.package})`;
    versionStr += version?.build?.commit ? `\ncommit: ${version?.build?.commit}/${version?.build?.branch}` : '';
    versionStr += version?.build?.date ? `\ntimestamp: ${version.build.date}` : '';

    return yargs()
        .env("EXPOSR")
        .version(versionStr)
        .middleware([
            (argv) => {
                argv.ingress = argv.ingress?.flatMap((v) => v.split(','));
                argv.transport = argv.transport?.flatMap((v) => v.split(','));
            }
        ], true)
        .showHidden('show-hidden', 'Show hidden options')
        .group([
            'ingress',
            'ingress-http-domain',
            'ingress-sni-port',
            'ingress-sni-host',
            'ingress-sni-cert',
            'ingress-sni-key',
        ], 'Ingress configuration')
        .option('ingress', {
            type: 'array',
            describe: 'Ingress methods to enable',
            default: 'http',
            choices: ['http', 'sni'],
        })
        .option('ingress-http-domain', {
            type: 'string',
            describe: 'Wildcard domain for HTTP ingress',
            example: 'https://tun.example.com creates https://<tunnel-id>.tun.example.com ingress points)',
            required: args['ingress']?.includes('http'),
            coerce: (url) => {
                return typeof url == 'string' ? new URL(url) : url;
            },
        })
        .option('ingress-sni-port', {
            type: 'integer',
            describe: 'Port to use for SNI ingress point',
            default: 4430,
        })
        .option('ingress-sni-host', {
            type: 'string',
            describe: 'Hostname for the SNI ingress point',
            hidden: true,
        })
        .option('ingress-sni-cert', {
            type: 'string',
            describe: 'Certificate chain in PEM format to use for SNI ingress',
            required: args['ingress']?.includes('sni'),
        })
        .option('ingress-sni-key', {
            type: 'string',
            describe: 'SNI ingress certificate private key in PEM format',
            required: args['ingress']?.includes('sni'),
        })
        .group([
            'transport',
            'transport-ssh-port',
            'transport-ssh-host',
            'transport-ssh-key',
        ], 'Transport configuration')
        .option('transport', {
            type: 'array',
            describe: 'Tunnel transports to enable',
            default: ['ws'],
            choices: ['ws', 'ssh'],
            coerce: (v) => {
                return typeof v === 'string' ? v.split(',') : v;
            }
        })
        .option('transport-ssh-port', {
            type: 'integer',
            describe: 'Port to use for SSH transport connection endpoint',
            default: 2200,
        })
        .option('transport-ssh-host', {
            type: 'string',
            describe: 'Hostname to use for SSH transport connection endpoint',
            hidden: true,
            coerce: (host) => {
                if (host == undefined) {
                    return host;
                }

                try {
                    const url = new URL(`ssh://${host}`);
                    return url.host;
                } catch (e) {
                    console.log(`Invalid hostname ${host}`);
                    process.exit(-1);
                }
            }
        })
        .option('transport-ssh-key', {
            type: 'string',
            describe: 'Path to, or string containing a SSH private key in PEM encoded OpenSSH format (or base64 encoded)',
            hidden: true,
            coerce: (key) => {
                if (key == undefined) {
                    return key;
                }
                const input = key;

                const isProbablyKey = (k) => {
                    return /BEGIN OPENSSH PRIVATE KEY/i.test(k);
                };

                try {
                    isFile = fs.statSync(key, { throwIfNoEntry: false }) != undefined;
                    if (isFile) {
                        key = fs.readFileSync(key).toString('utf-8');
                    }
                } catch (e) {}

                if (isProbablyKey(key)) {
                    return key;
                }

                key = Buffer.from(key, 'base64').toString('utf-8');
                if (isProbablyKey(key)) {
                    return key;
                }

                console.log(`transport-ssh-key requires either path to key or key content, got ${input}`);
                process.exit(-1);
            }
        })
        .group([
            'admin-enable',
            'admin-port',
            'admin-api-key',
            'admin-allow-access-without-api-key',
        ], 'Admin configuration')
        .option('admin-enable', {
            type: 'boolean',
            default: false,
            description: "Enable admin interface"
        })
        .option('admin-port', {
            type: 'number',
            default: 8081,
            description: "Admin port to listen on"
        })
        .option('admin-api-key', {
            type: 'string',
            description: 'API key for admin resource access'
        })
        .option('admin-allow-access-without-api-key', {
            type: 'boolean',
            default: false,
            hidden: true,
            description: 'Allow access to admin resource without any authentication'
        })
        .group([
            'api-url',
            'port',
            'allow-registration',
        ], 'API configuration')
        .option('api-url', {
            type: 'string',
            describe: 'Base URL for API (ex https://api.example.com). The API will only be available through this URL',
            coerce: (url) => {
                return typeof url == 'string' ? new URL(url) : url;
            }
        })
        .option('port', {
            alias: 'p',
            type: 'number',
            default: 8080,
            description: 'Server HTTP port to listen on',
        })
        .option('allow-registration', {
            type: 'boolean',
            default: false,
            description: 'Allow public account registration - NB: this allows public tunnel creation!'
        })
        .group([
            'redis-url',
        ], 'Storage configuration')
        .option('redis-url', {
            type: 'string',
            description: 'Redis connection URL, enables Redis persistance layer',
            coerce: (url) => {
                return typeof url == 'string' ? new URL(url) : url;
            },
        })
        .option('log-level', {
            type: 'string',
            default: 'info',
            choices: ['all', 'trace', 'debug', 'info', 'warn', 'error', 'fatal', 'off'],
        })
        .option('log-format', {
            type: 'string',
            hidden: true,
            default: 'json',
            choices: ['json'],
        })
        .scriptName('exposr-server')
        .parse(process.argv.slice(2));
}
class Config {
    constructor() {
        if (Config.instance !== undefined) {
            return Config.instance;
        }
        Config.instance = this;
        const args = parse();
        this._config = parse(args);
    }

    get(key) {
        return this._config[key];
    }

}

export default new Config();