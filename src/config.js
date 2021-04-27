import yargs from 'yargs';

const args = yargs
    .env("EXPOSR")
    .option('base-url', {
        type: 'string',
        describe: 'Base URL for API (ex https://api.example.com)',
        demandOption: true,
        coerce: (url) => {
            try {
                return new URL(url);
            } catch (err) {
                console.log(err.message);
                process.exit(-1);
            }
        },
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
            try {
                return new URL(url);
            } catch (err) {
                console.log(err.message);
                process.exit(-1);
            }
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
        description: 'Allow access to admin resource without any authentication'
    })
    .option('allow-registration', {
        type: 'boolean',
        default: false,
        description: 'Allow public account registration - NB: this allows public tunnel creation!'
    })
    .option('log-level', {
        type: 'string',
        default: 'info',
        choices: ['all', 'trace', 'debug', 'info', 'warn', 'error', 'fatal', 'off'],
    })
    .option('log-format', {
        type: 'string',
        default: 'json',
        choices: ['json'],
    })
class Config {
    constructor() {
        this._config = args.argv;
    }

    get(key) {
        return this._config[key];
    }

}

export default new Config();