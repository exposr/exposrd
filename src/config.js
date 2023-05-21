import yargs from 'yargs';
import fs from 'fs';
import Version from './version.js';

const parse = (canonicalArgv, callback, args = {}) => {
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
            'ingress-http-url',
            'ingress-http-port',
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
        .option('ingress-http-url', {
            type: 'string',
            describe: 'Base URL to use for the HTTP ingress',
            example: 'https://tun.example.com creates https://<tunnel-id>.tun.example.com ingress points)',
            default: args['ingress-http-domain'],
            required: args['ingress']?.includes('http'),
            coerce: (url) => {
                return typeof url == 'string' ? new URL(url) : url;
            },
        })
        .option('ingress-http-port', {
            type: 'number',
            describe: 'Port to use for HTTP ingress',
            default: 8080,
            hidden: true,
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
            'transport-max-connections',
            'transport-ws-port',
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
        .option('transport-max-connections', {
            type: 'integer',
            describe: 'Maximum number of client transport connections per tunnel',
            default: 2,
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
            'admin-api-enable',
            'admin-api-port',
            'admin-api-key',
            'admin-api-allow-access-without-key',
        ], 'Admin configuration')
        .option('admin-enable', {
            type: 'boolean',
            default: false,
            description: "Enable admin service interface"
        })
        .option('admin-port', {
            type: 'number',
            default: 8081,
            description: "Port to use for HTTP admin interface"
        })
        .option('admin-api-enable', {
            type: 'boolean',
            default: false,
            description: "Enable admin API interface"
        })
        .option('admin-api-port', {
            type: 'number',
            default: 8081,
            description: "Port to use for HTTP admin API interface"
        })
        .option('admin-api-key', {
            type: 'string',
            description: 'API key for admin resource access'
        })
        .option('admin-api-allow-access-without-key', {
            type: 'boolean',
            default: false,
            hidden: true,
            description: 'Allow access to admin API resource without any authentication'
        })
        .group([
            'api-url',
            'api-port',
            'allow-registration',
        ], 'API configuration')
        .option('api-url', {
            type: 'string',
            describe: 'Base URL for API (ex https://api.example.com). The API will only be available through this URL',
            coerce: (url) => {
                return typeof url == 'string' ? new URL(url) : url;
            }
        })
        .option('api-port', {
            alias: 'p',
            type: 'number',
            default: 8080,
            description: 'Port to use for HTTP API interface',
        })
        .option('allow-registration', {
            type: 'boolean',
            default: false,
            description: 'Allow public account registration - NB: this allows public tunnel creation!'
        })
        .group([
            'cluster',
            'cluster-key',
            'cluster-udp-discovery',
            'cluster-udp-port',
            'cluster-udp-discovery-multicast-group',
            'cluster-udp-discovery-kubernetes-service',
            'cluster-udp-discovery-kubernetes-namespace',
            'cluster-udp-discovery-kubernetes-service-env',
            'cluster-udp-discovery-kubernetes-namespace-env',
            'cluster-udp-discovery-kubernetes-cluster-domain',
            'cluster-redis-url',
        ], 'Cluster configuration')
        .option('cluster', {
            type: 'string',
            default: 'auto',
            choices: ['auto', 'single-node', 'udp', 'redis'],
            description: 'Set which clustering method to use',
            coerce: (value) => {
                if (value == 'auto' && args) {
                    if (args['redis-url']) {
                        return 'redis';
                    } else if (args['storage'] != 'none' && args['storage'] != 'sqlite') {
                        if (args['cluster-redis-url']) {
                            return 'redis';
                        } else {
                            return 'udp';
                        }
                    } else {
                        return 'single-node';
                    }
                }
                return value;
            }
        })
        .option('cluster-key', {
            type: 'string',
            default: 'secret-signing-key',
            description: "HMAC key used by nodes to sign pub/sub requests",
        })
        .option('cluster-udp-discovery', {
            type: 'string',
            default: 'auto',
            choices: ['auto', 'multicast', 'kubernetes'],
            description: 'Peer discovery method to use for UDP clustering mode',
        })
        .option('cluster-udp-port', {
            type: 'number',
            default: 1025,
            description: 'Port to use for UDP based pub/sub'
        })
        .option('cluster-udp-discovery-multicast-group', {
            type: 'string',
            default: '239.0.0.1',
            hidden: true,
            description: 'Set multicast group to use for multicast based peer discovery'
        })
        .option('cluster-udp-discovery-kubernetes-service', {
            type: 'string',
            hidden: true,
            description: 'Headless service name'
        })
        .option('cluster-udp-discovery-kubernetes-namespace', {
            type: 'string',
            hidden: true,
            description: 'Kubernetes namespace'
        })
        .option('cluster-udp-discovery-kubernetes-service-env', {
            type: 'string',
            hidden: true,
            default: 'SERVICE_NAME',
            description: 'Pod environment variable to read the headless service name from'
        })
        .option('cluster-udp-discovery-kubernetes-namespace-env', {
            type: 'string',
            hidden: true,
            default: 'POD_NAMESPACE',
            description: 'Pod environment variable to read namespace from'
        })
        .option('cluster-udp-discovery-kubernetes-cluster-domain', {
            type: 'string',
            hidden: true,
            default: 'cluster.local',
            description: 'The cluster domain suffix'
        })
        .option('cluster-redis-url', {
            type: 'string',
            description: 'Redis connection URL for cluster pub/sub',
            default: args['redis-url'],
            required: args['cluster'] == 'redis',
            coerce: (url) => {
                return typeof url == 'string' ? new URL(url) : url;
            },
        })
        .group([
            'storage',
            'storage-redis-url',
            'storage-sqlite-path',
            'storage-pgsql-url',
            'storage-pgsql-connection-pool',
        ], 'Persistent storage configuration')
        .option('storage', {
            type: 'string',
            default: 'none',
            choices: ['none', 'redis', 'sqlite', 'pgsql'],
            description: 'Set which persistent storage method to use',
            coerce: (value) => {
                if (value == 'none' && args) {
                    if (args['redis-url']) {
                        return 'redis';
                    } else if (args['storage-redis-url']) {
                        return 'redis';
                    }
                }
                return value;
            }
        })
        .option('storage-redis-url', {
            type: 'string',
            description: 'Redis connection URL for persistent storage',
            default: args['redis-url'],
            required: args['storage'] == 'redis',
            coerce: (url) => {
                return typeof url == 'string' ? new URL(url) : url;
            },
        })
        .option('storage-sqlite-path', {
            type: 'string',
            description: 'Path to SQlite database',
            default: 'db.sqlite',
            required: args['storage'] == 'sqlite',
        })
        .option('storage-pgsql-url', {
            type: 'string',
            description: 'Postgres connection URL for persistent storage',
            required: args['storage'] == 'pgsql',
            coerce: (url) => {
                return typeof url == 'string' ? new URL(url) : url;
            },
        })
        .option('storage-pgsql-connection-pool-size', {
            type: 'number',
            description: 'Postgres connection pool size',
            default: 10,
            hidden: true,
        })
        .group([
            'redis-url',
            'ingress-http-domain'
        ], 'Deprecated options')
        .option('redis-url', {
            type: 'string',
            hidden: true,
            description: '[DEPRECATED] Redis connection URL. Use --storage-redis-url and/or --cluster-redis-url',
            coerce: (url) => {
                return typeof url == 'string' ? new URL(url) : url;
            },
        })
        .option('ingress-http-domain', {
            type: 'string',
            hidden: true,
            describe: '[DEPRECATED] Use --ingress-http-url instead',
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
        .check((argv) => {
            if (Object.keys(args) == 0) {
                return true;
            }

            if (argv['storage'] == 'sqlite' && argv['cluster'] != 'single-node') {
                throw new Error("SQlite storage can only be used in single-node mode");
            }

            return true;
        })
        .scriptName('exposr-server')
        .wrap(120)
        .parse(canonicalArgv, callback);
}

class Config {
    constructor(argv) {
        if (Config.instance !== undefined) {
            return Config.instance;
        }
        Config.instance = this;

        if (process.env.EXPOSR_EMBEDDED) {
            this._config = {};
            return;
        }

        argv ??= process.argv.slice(2);

        const cb = (err, _, output) => {
            if (err) {
                this._error = err;
                if (process.env.NODE_ENV === 'test') {
                    return;
                }
                console.log(output);
                process.exit(-1);
            } else if (output) {
                console.log(output);
                process.exit(0);
            }
        };

        const args = parse(argv, cb);
        this._config = parse(argv, cb, args);
    }

    async destroy() {
        delete Config.instance;
    }

    get(key) {
        return this._config[key];
    }

}

export default Config;