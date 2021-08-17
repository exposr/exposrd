import crypto, { X509Certificate } from 'crypto';
import fs from 'fs';
import tls from 'tls';
import { Logger } from '../logger.js';
import TunnelService from '../tunnel/tunnel-service.js';
import IngressUtils from './utils.js';

const logger = Logger("sni-ingress");

class SNIIngress {
    constructor(opts) {
        this.opts = opts;

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

        server.on('secureConnection', (socket) => {
            this._handleConnection(socket);
        });

        const conError = (err) => {
            typeof opts.callback === 'function' && opts.callback(err);
            logger.error({
                message: `Failed to start SNI ingress: ${err.message}`,
            });
        };
        server.once('error', conError);

        server.listen(this.port, () => {
            logger.info({
                message: "SNI ingress initialized",
                port: this.port,
                host: this.host,
            });
            server.removeListener('error', conError);
            typeof opts.callback === 'function' && opts.callback();
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
            logger.warn({
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
            logger.warn({
                operation: 'sni-load-cert',
                msg: 'private key does not match certificate',
            });
            return false;
        }

        const wildSubs = SNIIngress._getWildcardSubjects(x509cert);
        if (wildSubs.length == 0) {
            logger.warn({
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
            logger.warn({
                operation: 'sni-load-cert',
                msg: 'failed to parse any of the certificate subjects as FQDN',
            });
            return false;
        }

        this.sniUrl = sniUrl;

        if (wildSubs.length > 1) {
            logger.info({
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

        logger.info({
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
            logger.withContext('tunnel', tunnelId).trace({
                msg: 'SNI ingress disabled for tunnel'
            });
            return close();
        }

        logger.withContext('tunnel', tunnelId).info({
            operation: 'sni-connect',
            servername,
            peer,
            upstream: {
                ...tunnel.upstream
            },
        });

        const startTime = process.hrtime.bigint();
        socket.on('close', () => {
            const elapsedMs = Math.round(Number((process.hrtime.bigint() - BigInt(startTime))) / 1e6);
            logger.withContext('tunnel', tunnelId).info({
                operation: 'sni-disconnect',
                servername,
                peer,
                upstream: {
                    ...tunnel.upstream
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
        const upstream = this.tunnelService.createConnection(tunnelId, ctx);
        const logError = (err) => {
            logger.info({
                operation: 'sni-error',
                peer,
                err,
            });
        };

        upstream.on('close', () => {
            socket.end();
            socket.destroy();
        });

        upstream.on('error', (err) => {
            logError(err);
            socket.end();
            socket.destroy();
        });

        socket.on('error', (err) => {
            logError(err);
            upstream.end();
            upstream.destroy();
        });

        upstream.pipe(socket);
        socket.pipe(upstream);
    }

    async destroy() {
        this.destroyed = true;
        return new Promise((resolve) => {
            this.server.close();
            resolve();
        });
    }
}

export default SNIIngress;