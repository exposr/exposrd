import crypto from 'crypto';
import ssh from 'ssh2';
import sshpk from 'sshpk';
import { Logger } from '../../logger.js';
import TunnelService from '../../tunnel/tunnel-service.js';
import Version from '../../version.js';
import SSHTransport from './ssh-transport.js';

const sshBanner = `exposr/${Version.version.version}`;

class SSHEndpoint {
    constructor(opts) {
        this.opts = opts;
        this.logger = Logger("ssh-transport-endpoint");
        this.tunnelService = new TunnelService();
        this._clients = new Set();

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

        const server = this._server = new ssh.Server({
            hostKeys: [this._hostkey],
            banner: sshBanner,
        });

        server.on('connection', (client, clientInfo) => {
            this.logger.info({
                operation: 'connection',
                info: {
                    ip: clientInfo.ip,
                    port: clientInfo.port,
                    ident: clientInfo.identRaw,
                },
            })

            this._clients.add(client);
            client.once('close', () => {
                this._clients.delete(client);
            });
            this._handleClient(client, clientInfo);
        });

        const connectionError = (err) => {
            this.logger.error({
                message: `Failed to initialize ssh transport connection endpoint: ${err}`,
            });
            typeof opts.callback === 'function' && opts.callback(err);
        };
        server.once('error', connectionError);
        server.listen(opts.port, (err) => {
            server.removeListener('error', connectionError);
            this.logger.info({
                msg: 'SSH transport endpoint initialized',
                fingerprint: this._fingerprint
            });
            typeof opts.callback === 'function' && opts.callback();
        });
    }

    async destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        return new Promise((resolve) => {
            this._server.once('close', async () => {
                await this.tunnelService.destroy();
                resolve();
            });
            this._server.close();
            this._clients.forEach((client) => client.destroy());
        });
    }

    getEndpoint(tunnel, baseUrl) {
        const host = this.opts.host ?? baseUrl.hostname;
        const port = this.opts.port;
        const username = tunnel.id;
        const password = tunnel.transport.token;
        const fingerprint = this._fingerprint;

        let url;
        try {
            url = new URL(`ssh://${username}:${password}@${host}`);
            if (!url.port) {
                url.port = port;
            }
        } catch (e) {
            return {};
        }

        return {
            host: url.hostname,
            post: url.port,
            username,
            password,
            url: url.href,
            fingerprint,
        };
    }

    _handleClient(client, info) {
        let tunnel;
        let account;
        client.on('authentication', async (ctx) => {
            const [tunnelId, token] = ctx.username.split(':');

            const reject = () => {
                ctx.reject();
                client.end();
            };

            const authResult = await this.tunnelService.authorize(tunnelId, token);
            if (authResult.authorized == false) {
                return reject();
            }

            tunnel = authResult.tunnel;
            account = authResult.account;

            if (tunnel.state().connected) {
                return reject();
            }

            ctx.accept();
        });

        client.on('ready', async (ctx) => {
            const transport = new SSHTransport({
                tunnelId: tunnel.id,
                target: tunnel.target.url,
                client,
            });
            const res = await this.tunnelService.connect(tunnel.id, account.id, transport, { peer: info.ip });
            if (!res) {
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

export default SSHEndpoint;