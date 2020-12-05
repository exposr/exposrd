import yargs from 'yargs';

const args = yargs
    .env("UTP")
    .option('subdomain-url', {
        alias: 's',
        type: 'string',
        describe: 'Subdomain hostname used for tunnels, ex. https://example.com',
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
    .demandOption(["subdomain-url"])

class Config {
    constructor() {
        this._config = args.argv;
    }

    get(key) {
        return this._config[key];
    }

}

export default new Config();