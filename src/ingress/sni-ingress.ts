import crypto, { KeyObject, X509Certificate } from 'crypto';
import fs from 'fs';
import tls from 'tls';
import { Logger } from '../logger.js';
import TunnelService, { CreateConnectionContext } from '../tunnel/tunnel-service.js';
import IngressUtils from './utils.js';
import IngressBase from './ingress-base.js';
import Tunnel from '../tunnel/tunnel.js';

export type SniIngressOptions = {
    host?: string | undefined,
    port: number,
    cert: string,
    key: string,
}

type _SniIngressOptions = SniIngressOptions & {
    callback: (error?: Error) => void;
}

export default class SNIIngress implements IngressBase {
    private opts: _SniIngressOptions;
    private logger: any;
    private tunnelService: TunnelService;
    private server: tls.Server;
    private _clients: Set<tls.TLSSocket>;
    private ctx!: tls.SecureContext;

    private port: number;
    private host!: URL;
    private sniUrl!: URL;

    private cert!: Buffer;
    private rawKey!: Buffer;
    private key!: KeyObject;
    private x509cert: any;

    constructor(opts: _SniIngressOptions) {
        this.opts = opts;
        this.logger = Logger("sni-ingress");

        if (!opts.cert) {
            throw new Error("No certificate provided for SNI ingress");
        }

        if (!opts.key) {
            throw new Error("No key provided for SNI ingress");
        }

        this.tunnelService = new TunnelService();

        this.port = this.opts.port || 4430;

        if (this.opts.host) {
            try {
                let host = this.opts.host;
                if (!host.includes("://")) {
                    host = `tcps://${host}`;
                }
                this.host = new URL(host);
                if (!this.host.port) {
                    this.host.port = `${this.port}`;
                }
            } catch {}
        }

        if (!this._loadCert()) {
            throw new Error("Failed to load certificate");
        }

        const certUpdated = (cur: fs.Stats, prev: fs.Stats) => {
            if (cur.mtime != prev.mtime) {
                this._loadCert();
            }
        };

        fs.watchFile(opts.cert, certUpdated);
        fs.watchFile(opts.key, certUpdated);

        const server = this.server = tls.createServer({
            SNICallback: (servername: string, cb: (err: Error | null, ctx: tls.SecureContext | undefined) => void) => {
                this._sniCallback(servername, cb);
            },
        });

        this._clients = new Set();
        server.on('secureConnection', async (socket) => {
            const res = await this._handleConnection(socket);
            if (!res) {
                return;
            }

            this._clients.add(socket);
            socket.once('close', () => {
                this._clients.delete(socket);
            });
        });

        const conError = (err: Error) => {
            typeof opts.callback === 'function' && opts.callback(err);
            this.logger.error({
                message: `Failed to start SNI ingress: ${err.message}`,
            });
        };
        server.once('error', conError);

        server.listen(this.port, () => {
            this.logger.info({
                message: `SNI ingress listening on port ${this.port}`,
                host: this.host,
            });
            server.removeListener('error', conError);
            typeof opts.callback === 'function' && opts.callback();
        });
    }

    async destroy(): Promise<void> {
        await new Promise((resolve) => {
            this.server.once('close', async () => {
                resolve(undefined);
            });
            this.server.close();
            this._clients.forEach((sock) => sock.destroy());
        });
        await this.tunnelService.destroy();
    }

    public getBaseUrl(tunnelId: string): URL {
        const url = new URL(this.sniUrl);
        if (tunnelId) {
            url.hostname = `${tunnelId}.${url.hostname}`;
        }
        return url;
    }

    private static _getWildcardSubjects(x509cert: crypto.X509Certificate) {
        const subject = x509cert.subject.split('CN=')[1];
        const san = x509cert.subjectAltName
            ?.split(',')
            .map(s => {
                return s.split('DNS:')[1]?.trim();
            })
            .filter(n => n?.length > 1);

        const names = [];
        subject && names.push(subject);
        san && names.push(...san);

        return names.filter(name => name?.startsWith('*.'));
    }

    private _loadCert(): boolean {

        const log_cert_load_error = (message: string): void => {
            this.logger.warn({
                operation: 'sni-load-cert',
                message,
            });
        };

        let x509cert: crypto.X509Certificate;
        let cert: Buffer;
        try {
            cert = fs.readFileSync(this.opts.cert);
            x509cert = new X509Certificate(cert);
        } catch (e: any) {
            log_cert_load_error(`Could not parse certificate: ${e.message}`);
            return false;
        }

        let key: Buffer;
        try {
            key = fs.readFileSync(this.opts.key);
            this.key = crypto.createPrivateKey(key);
            if (!x509cert.checkPrivateKey(this.key)) {
                throw new Error(`private key does not match certificate'`)
            }
        } catch (e: any) {
            log_cert_load_error(`Could not parse private key: ${e.message}`)
            return false;
        }

        const wildSubs = SNIIngress._getWildcardSubjects(x509cert);
        if (wildSubs.length == 0) {
            log_cert_load_error(`certificate has no wildcard subjects'`)
            return false;
        }

        let sniUrl;
        for (const sub of wildSubs) {
            const port = this.host?.port || this.port;
            const host = sub.split('*.')[1];
            if (this.host != undefined && this.host.hostname != host) {
                continue;
            }
            try {
                sniUrl = new URL(`tcps://${host}:${port}`);
                break;
            } catch (e) {}
        }

        if (!sniUrl) {
            log_cert_load_error('failed to parse any of the certificate subjects as FQDN');
            return false;
        }

        this.sniUrl = sniUrl;

        if (wildSubs.length > 1) {
            this.logger.info({
                operation: 'sni-load-cert',
                message: `certificate has multiple wildcard subjects, using ${this.sniUrl.hostname} as primary ingress`,
            });
        }

        this.cert = cert;
        this.rawKey = key;
        this.x509cert = x509cert;
        this.ctx = tls.createSecureContext({
          key: this.rawKey,
          cert: this.cert,
        });

        this.logger.info({
            operation: 'sni-load-cert',
            message: 'certificate loaded',
            'ingress-domain': this.sniUrl.hostname,
            subjects: wildSubs.join(', ')
        });
        return true;
    }

    private async getTunnel(servername: string): Promise<Tunnel> {
        const tunnelId: string | undefined = IngressUtils.getTunnelId(servername);

        if (tunnelId == undefined) {
            throw new Error('failed_to_parse_servername');
        }

        const tunnel = await this.tunnelService.lookup(tunnelId);
        if (!tunnel.config.ingress?.sni?.enabled) {
            throw new Error('ingress_disabled');
        }
        return tunnel;
    }

    private async _sniCallback(servername: string, cb: (err: Error | null, ctx: tls.SecureContext | undefined) => void): Promise<void> {
        try {
            const tunnel = await this.getTunnel(servername);
            cb(null, this.ctx);
        } catch (err: any) {
            this.logger.debug({
                message: `Failed to determine tunnel for ${servername}: ${err.message}`
            });
            cb(err, undefined);
        }
    }

    private async _handleConnection(socket: tls.TLSSocket): Promise<boolean> {
        const peer = {
            addr: socket.remoteAddress,
            port: socket.remotePort,
        };

        const servername = (<any>socket).servername;
        let tunnel: Tunnel;
        try {
            tunnel = await this.getTunnel(servername);
        } catch (e: any) {
            socket.end();
            socket.destroy();
            return false;
        }

        this.logger.withContext('tunnel', tunnel.id).info({
            operation: 'sni-connect',
            servername,
            peer,
            target: {
                ...tunnel.config.target
            },
        });

        const startTime = process.hrtime.bigint();
        socket.once('close', () => {
            const elapsedMs = Math.round(Number((process.hrtime.bigint() - BigInt(startTime))) / 1e6);
            this.logger.withContext('tunnel', tunnel.id).info({
                operation: 'sni-disconnect',
                servername,
                peer,
                target: {
                    ...tunnel.config.target
                },
                duration: elapsedMs,
                bytes: {
                    read: socket.bytesRead,
                    written: socket.bytesWritten,
                },
            });
        })

        const ctx: CreateConnectionContext = {
            remoteAddr: socket.remoteAddress || '',
            ingress: {
                tls: true,
                port: this.port,
            },
        };

        const targetSock = this.tunnelService.createConnection(tunnel.id, ctx, (err, sock) => {
            if (err) {
                logError(err);
                return;
            }
            sock.pipe(socket);
            socket.pipe(sock);
        });

        const logError = (err: Error) => {
            this.logger.info({
                operation: 'sni-error',
                peer,
                err,
            });
        };

        const error = (err: Error) => {
            logError(err);
            close();
        };

        const close = () => {
            targetSock.unpipe(socket);
            socket.unpipe(targetSock);
            socket.off('close', close);
            targetSock.off('close', close);
            socket.off('error', close);
            targetSock.off('error', close);
            socket.destroy();
            targetSock.destroy();
        };

        targetSock.on('close', close);
        socket.on('close', close);
        targetSock.on('error', error);
        socket.on('error', error);

        return true;
    }
}