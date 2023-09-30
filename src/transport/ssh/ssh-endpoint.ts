import crypto from 'crypto';
import ssh, { AuthContext } from 'ssh2';
import sshpk from 'sshpk';
import { Logger } from '../../logger.js';
import TunnelService from '../../tunnel/tunnel-service.js';
import Version from '../../version.js';
import SSHTransport from './ssh-transport.js';
import TransportEndpoint, { EndpointResult, TransportEndpointOptions } from '../transport-endpoint.js';
import Tunnel from '../../tunnel/tunnel.js';
import Account from '../../account/account.js';
import Transport from '../transport.js';

const sshBanner = `exposr/${Version.version.version}`;

export type SSHEndpointOptions = {
    enabled: boolean,
    hostKey?: string,
    host?: string,
    port: number,
    allowInsecureTarget: boolean,
}

export type _SSHEndpointOptions = SSHEndpointOptions & TransportEndpointOptions & {
    callback?: (err?: Error | undefined) => void,
}

export interface SSHEndpointResult extends EndpointResult {
    host: string,
    port: number,
    username: string,
    password: string,
    url: string,
    fingerprint: string,
}

export default class SSHEndpoint extends TransportEndpoint {
    private opts: _SSHEndpointOptions;
    private logger: any;
    private tunnelService: TunnelService;
    private _clients: Array<Transport>;

    private _hostkey: string;
    private _fingerprint: string;
    private _server: ssh.Server;

    constructor(opts: _SSHEndpointOptions) {
        super(opts)
        this.opts = opts;
        this.logger = Logger("ssh-transport-endpoint");
        this.tunnelService = new TunnelService();

        const generateHostKey = () => {
            const keys = crypto.generateKeyPairSync('rsa', {
                modulusLength: 2048,
                publicKeyEncoding: {
                    type: 'spki',
                    format: 'pem',
                },
                privateKeyEncoding: {
                    type: 'pkcs8',
                    format: 'pem',
                }
            });

            const key = sshpk.parsePrivateKey(keys.privateKey, 'pem');
            return key.toString('ssh');
        };

        this._hostkey = opts.hostKey || generateHostKey();
        this._fingerprint = sshpk.parsePrivateKey(this._hostkey).fingerprint().toString();
        this._clients = [];

        const server = this._server = new ssh.Server({
            hostKeys: [this._hostkey],
            banner: sshBanner,
            ident: sshBanner,
        });

        server.on('connection', (client, clientInfo) => {
            this.logger.info({
                operation: 'connection',
                info: {
                    ip: clientInfo.ip,
                    port: clientInfo.port,
                    header: clientInfo.header,
                },
            })

            client.once('close', () => {
                client.removeAllListeners();
            });

            this._handleClient(client, clientInfo);
        });

        const connectionError = (err: Error) => {
            this.logger.error({
                message: `Failed to initialize ssh transport connection endpoint: ${err}`,
            });
            typeof opts.callback === 'function' && opts.callback(err);
        };
        server.once('error', connectionError);
        server.listen(opts.port, () => {
            server.removeListener('error', connectionError);
            this.logger.info({
                message: `SSH transport endpoint listening on port ${opts.port}`,
                port: opts.port,
                fingerprint: this._fingerprint
            });

            server.on('error', (err: Error) => {
                this.logger.error({
                    message: `SSH transport error: ${err.message}`
                });
                this.logger.debug({
                    stack: `${err.stack}`
                });
            });
            typeof opts.callback === 'function' && opts.callback();
        });
    }

    protected async _destroy(): Promise<void> {
        await new Promise(async (resolve) => {
            this._server.once('close', async () => {
                await this.tunnelService.destroy();
                this._server.removeAllListeners();
                resolve(undefined);
            });
            for (const transport of this._clients) {
                await transport.destroy();
            }
            this._clients = [];
            this._server.close();
        });
    }

    public getEndpoint(tunnel: Tunnel, baseUrl: URL): SSHEndpointResult {
        const host = this.opts.host ?? baseUrl.hostname;
        const port = this.opts.port;
        const username = tunnel.id;
        const password = tunnel.config.transport.token || "";
        const fingerprint = this._fingerprint;

        let url;
        try {
            url = new URL(`ssh://${username}:${password}@${host}`);
            if (!url.port) {
                url.port = `${port}`;
            }
        } catch (e) {
            return <any>{};
        }

        return {
            host: url.hostname,
            port: Number.parseInt(url.port),
            username,
            password,
            url: url.href,
            fingerprint,
        };
    }

    private _handleClient(client: ssh.Connection, info: ssh.ClientInfo): void {
        let tunnel: Tunnel;
        let account: Account;

        client.once('authentication', async (ctx: AuthContext) => {
            let [tunnelId, token] = ctx.username.split(':');

            if (ctx.method == 'none' && token == undefined) {
                return ctx.reject();
            }

            if (ctx.method == 'password' && token == undefined) {
                token = ctx.password;
            }

            const reject = () => {
                ctx.reject();
                client.end();
            };

            if (token == undefined) {
                return reject();
            }

            const authResult = await this.tunnelService.authorize(tunnelId, token);
            if (authResult.authorized == false) {
                return reject();
            }

            if (!authResult.tunnel || !authResult.account) {
                return reject();
            }

            tunnel = authResult.tunnel;
            account = authResult.account;

            ctx.accept();
        });

        client.once('ready', async () => {
            const transport = new SSHTransport({
                tunnelId: tunnel.id,
                target: tunnel.config.target.url,
                max_connections: this.opts.max_connections,
                allowInsecureTarget: this.opts.allowInsecureTarget,
                client,
            });
            const res = await this.tunnelService.connect(tunnel.id, account.id, transport, { peer: info.ip });
            if (res) {
                this._clients.push(transport);
                transport.once('close', () => {
                    this._clients = this._clients.filter((t) => t.id != transport.id);
                });
            } else {
                this.logger
                    .withContext("tunnel", tunnel.id)
                    .error({
                        operation: 'transport_connect',
                        msg: 'failed to connect transport'
                    });
                transport.destroy();
            }
        });

    }
}