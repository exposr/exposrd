import assert from 'assert/strict';
import crypto, { X509Certificate } from 'crypto';
import fs from 'fs';
import tls from 'tls';
import { Logger } from '../logger.js';
import TunnelService from '../tunnel/tunnel-service.js';
import IngressUtils from './utils.js';

class SNIIngress {
    constructor(opts) {
        this.opts = opts;
        this.logger = Logger("sni-ingress");

        if (!opts.cert) {
            throw new Error("No certificate provided for SNI ingress");
        }

        if (!opts.key) {
            throw new Error("No key provided for SNI ingress");
        }

        this.tunnelService = opts.tunnelService;
        assert(this.tunnelService instanceof TunnelService);

        this.port = this.opts.port || 4430;

        if (this.opts.host) {
            try {
                let host = this.opts.host;
                if (!host.includes("://")) {
                    host = `tcps://${host}`;
                }
                this.host = new URL(host);
                if (!this.host.port) {
                    this.host.port = this.port;
                }
            } catch {}
        }

        if (!this._loadCert()) {
            throw new Error("Failed to load certificate");
        }

        const certUpdated = (cur, prev) => {
            if (cur.mtime != prev.mtime) {
                this._loadCert();
            }
        };

        fs.watchFile(opts.cert, certUpdated);
        fs.watchFile(opts.key, certUpdated);

        const server = this.server = tls.createServer({
            SNICallback: (servername, cb) => {
                cb(null, this.ctx);
            },
        });

        this._clients = new Set();
        server.on('secureConnection', (socket) => {
            this._handleConnection(socket);
            this._clients.add(socket);
            socket.once('close', () => {
                this._clients.delete(socket);
            });
        });

        const conError = (err) => {
            typeof opts.callback === 'function' && opts.callback(err);
            this.logger.error({
                message: `Failed to start SNI ingress: ${err.message}`,
            });
        };
        server.once('error', conError);

        server.listen(this.port, () => {
            this.logger.info({
                message: "SNI ingress initialized",
                port: this.port,
                host: this.host,
            });
            server.removeListener('error', conError);
            typeof opts.callback === 'function' && opts.callback();
        });
    }

    async destroy() {
        return new Promise((resolve) => {
            this.server.once('close', async () => {
                resolve();
            });
            this.server.close();
            this._clients.forEach((sock) => sock.destroy());
        });
    }

    getBaseUrl(tunnelId = undefined) {
        const url = new URL(this.sniUrl);
        if (tunnelId) {
            url.hostname = `${tunnelId}.${url.hostname}`;
        }
        return url;
    }

    getIngress(tunnel) {
        const url = this.getBaseUrl(tunnel.id).href;
        return {
            url,
            urls: [
                url,
            ],
        };
    }

    static _getWildcardSubjects(x509cert) {
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

    _loadCert() {

        const logerr = (msg) => {
            this.logger.warn({
                operation: 'sni-load-cert',
                msg,
            });
        };

        const tryable = (fn, err) => {
            try {
                const res = fn();
                return res;
            } catch (e) {
                err && err(e);
                return undefined;
            }
        };

        const cert = tryable(
            () => { return fs.readFileSync(this.opts.cert) },
            (e) => { logerr(e.message) }
        );
        const key = tryable(
            () => { return fs.readFileSync(this.opts.key) },
            (e) => { logerr(e.message) }
        );
        if (!cert || !key) {
            return false;
        }

        const x509cert = tryable(
            () => { return new X509Certificate(cert); },
            (e) => { logerr(`Could not parse certificate: ${e.message}`) }
        );
        const keyObj = tryable(
            () => { return crypto.createPrivateKey(key); },
            (e) => { logerr(`Could not parse private key: ${e.message}`) }
        );

        if (!x509cert.checkPrivateKey(keyObj)) {
            this.logger.warn({
                operation: 'sni-load-cert',
                msg: 'private key does not match certificate',
            });
            return false;
        }

        const wildSubs = SNIIngress._getWildcardSubjects(x509cert);
        if (wildSubs.length == 0) {
            this.logger.warn({
                operation: 'sni-load-cert',
                msg: 'certificate has no wildcard subjects',
            });
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
            this.logger.warn({
                operation: 'sni-load-cert',
                msg: 'failed to parse any of the certificate subjects as FQDN',
            });
            return false;
        }

        this.sniUrl = sniUrl;

        if (wildSubs.length > 1) {
            this.logger.info({
                operation: 'sni-load-cert',
                msg: `certificate has multiple wildcard subjects, using ${this.sniUrl.hostname} as primary ingress`,
            });
        }

        this.cert = cert;
        this.key = key;
        this.x509cert = x509cert;
        this.ctx = tls.createSecureContext({
          key: this.key,
          cert: this.cert,
        });

        this.logger.info({
            operation: 'sni-load-cert',
            msg: 'certificate loaded',
            'ingress-domain': this.sniUrl.hostname,
            subjects: wildSubs.join(', ')
        });
        return true;
    }

    async _handleConnection(socket) {
        const peer = {
            addr: socket.remoteAddress,
            port: socket.remotePort,
        };

        const close = () => {
            socket.end();
            socket.destroy();
        };

        const servername = socket.servername;
        if (servername == undefined) {
            return close();
        }

        const tunnelId = IngressUtils.getTunnelId(servername);
        if (tunnelId == undefined) {
            return close();
        }

        const tunnel = await this.tunnelService.lookup(tunnelId);
        if (tunnel == undefined) {
            return close();
        }

        if (!tunnel.ingress?.sni?.enabled) {
            this.logger.withContext('tunnel', tunnelId).trace({
                msg: 'SNI ingress disabled for tunnel'
            });
            return close();
        }

        this.logger.withContext('tunnel', tunnelId).info({
            operation: 'sni-connect',
            servername,
            peer,
            target: {
                ...tunnel.target
            },
        });

        const startTime = process.hrtime.bigint();
        socket.on('close', () => {
            const elapsedMs = Math.round(Number((process.hrtime.bigint() - BigInt(startTime))) / 1e6);
            this.logger.withContext('tunnel', tunnelId).info({
                operation: 'sni-disconnect',
                servername,
                peer,
                target: {
                    ...tunnel.target
                },
                duration: elapsedMs,
                bytes: {
                    read: socket.bytesRead,
                    written: socket.bytesWritten,
                },
            });
        })

        const ctx = {
            ingress: {
                tls: true,
                port: this.port,
            },
        };
        const target = this.tunnelService.createConnection(tunnelId, ctx);
        const logError = (err) => {
            this.logger.info({
                operation: 'sni-error',
                peer,
                err,
            });
        };

        target.on('close', () => {
            socket.end();
            socket.destroy();
        });

        target.on('error', (err) => {
            logError(err);
            socket.end();
            socket.destroy();
        });

        socket.on('error', (err) => {
            logError(err);
            target.end();
            target.destroy();
        });

        target.pipe(socket);
        socket.pipe(target);
    }
}

export default SNIIngress;