import yargs from 'yargs';
import Version from './version.js';

const version = Version.version;
let versionStr = `version: ${version.version} (pkg ${version.package})`;
versionStr += version?.build?.commit ? `\ncommit: ${version?.build?.commit}/${version?.build?.branch}` : '';
versionStr += version?.build?.date ? `\ntimestamp: ${version.build.date}` : '';

const args = yargs(process.argv.slice(2))
    .env("EXPOSR")
    .version(versionStr)
    .showHidden('show-hidden', 'Show hidden options')
    .option('api-url', {
        type: 'string',
        describe: 'Base URL for API (ex https://api.example.com). The API will only be available through this URL',
        coerce: (url) => {
            return typeof url == 'string' ? new URL(url) : url;
        }
    })
    .option('ingress', {
        type: 'array',
        describe: 'Ingress to enable',
        default: ['http'],
        choices: ['http']
    })
    .option('http-ingress-domain', {
        type: 'string',
        describe: 'Wildcard domain for HTTP ingress (ex. https://tun.example.com creates https://<tunnel-id>.tun.example.com ingress points)',
        coerce: (url) => {
            return typeof url == 'string' ? new URL(url) : url;
        },
    })
    .option('port', {
        alias: 'p',
        type: 'number',
        default: 8080,
        description: 'Server port to listen on',
    })
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
    .option('allow-registration', {
        type: 'boolean',
        default: false,
        description: 'Allow public account registration - NB: this allows public tunnel creation!'
    })
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

class Config {
    constructor() {
        this._config = args.argv;
    }

    get(key) {
        return this._config[key];
    }

}

export default new Config();