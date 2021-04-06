import yargs from 'yargs';

const args = yargs
    .env("UTP")
    .option('ingress', {
        type: 'array',
        describe: 'Ingress to enable',
        default: ['http'],
        choices: ['http']
    })
    .option('http-ingress-domain', {
        type: 'string',
        describe: 'Wildcard domain for HTTP ingress (ex. https://example.com creates https://<tunnel-id>.example.com ingress points)',
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
    .option('enable-admin', {
        type: 'boolean',
        default: false,
        description: "Enable admin interface"
    })
    .option('admin-port', {
        type: 'number',
        default: 8081,
        description: "Admin port to listen on"
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