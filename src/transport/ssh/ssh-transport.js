import assert from 'assert/strict';
import { EventEmitter } from 'events';
import { Duplex } from 'stream';
import tls from 'tls';
import Ingress from '../../ingress/index.js';
import logger from '../../logger.js';
import TunnelService from '../../tunnel/tunnel-service.js';
import Hostname from '../../utils/hostname.js';

class SSHTransport extends EventEmitter {
    constructor(opts) {
        super();

        this._tunnelService = new TunnelService();
        const client = this._client = opts.client;

        try {
            this._upstream = new URL(opts.upstream);
        } catch (e) {
            this._upstream = new URL("tcp://");
        }

        client.on('session', (accept, reject) => {
            const session = accept();
            session.on('pty', (accept, reject, info) => {
                accept();
            });
            session.on('shell', (accept, reject) => {
                const stream = accept();
                const ingress = new Ingress().getIngress(opts.tunnelId);
                stream.write(`Upstream target: ${this._upstream.href}\r\n`);
                if (ingress?.http?.url) {
                    stream.write(`HTTP ingress: ${ingress.http.url}\r\n`);
                }

                stream.on('data', (data) => {
                    if (data[0] == 0x03) {
                        this.destroy();
                    }
                })
            });
        });

        client.on('request', (accept, reject, name, info) => {
            if (name !== 'tcpip-forward') {
                return reject();
            }

            const bindUrl = this._bindaddr = Hostname.parse(info.bindAddr, info.bindPort);
            if (bindUrl && bindUrl.hostname != 'localhost') {
                if (bindUrl.href != this._upstream.href) {
                    this._upstream = bindUrl;
                    this._tunnelService.update(opts.tunnelId, undefined, (tunnel) => {
                        tunnel.upstream.url = bindUrl.href;
                    });
                    logger.info({
                        operation: 'update-upstream',
                        upstream: bindUrl.href,
                    });
                }
            }

            const port = Hostname.getPort(this._upstream);
            if (port > 0) {
                accept(port);
            } else {
                reject();
            }
        });

        client.on('close', () => {
            this.destroy();
        });
    }

    createConnection(opts = {}, callback) {
        const sock = new SSHTransportSocket({
            ...opts,
            client: this._client,
            upstream: this._upstream,
            bindaddr: this._bindaddr,
        });
        sock.connect(callback);
        return sock;
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this._client.end();
        this.destroyed = true;
        this.emit('close');
    }
}

class SSHTransportSocket extends Duplex {

    constructor(opts) {
        super({
            setDefaultEncoding: 'binary'
        })
        this.connecting = false;
        this.destroyed = false;
        this.pending = true;
        this.readyState = undefined;
        this.bytesRead = 0;
        this.bytesWritten = 0;

        this._client = opts.client;
        this._upstream = opts.upstream;
        this._bindaddr = opts.bindaddr;

        super.cork();
        super.pause();
    }

    toString() {
        return `<${SSHTransportSocket.name}  state=${this.readyState}>`;
    }

    connect(callback) {
        if (this.readyState === "opening") {
            callback(new CustomError(EINPROGRESS, `connection already in progress ${this.toString}`));
            return;
        }

        this.connecting = true;
        this.readyState = "opening";

        if (typeof callback === 'function') {
            this.once('connect', callback);
        }

        const port = Hostname.getPort(this._upstream);
        this._client.forwardOut(this._bindaddr.hostname, port, this._upstream.hostname, port, (err, stream) => {
            this.connecting = false;
            if (err) {
                typeof callback === 'function' && this.removeListener('connect', callback);
                this.readyState = undefined;
                this.emit('close', err);
                return;
            }

            this._stream = stream;
            const isTLS = Hostname.isTLS(this._upstream);
            if (isTLS) {
                const tlsSock = tls.connect({
                    servername: this._upstream.hostname,
                    socket: stream,
                });
                stream = tlsSock;
                tlsSock.on('error', () => {
                    this.destroy();
                });
            }

            this.readyState = "open";
            this.pending = false;

            this._socket = stream;

            stream.on('data', (data) => {
                this.emit('data', data);
            });

            stream.on('close', hadError => this.emit('close', hadError));
            stream.on('end', () => this.emit('end'));
            stream.on('drain', () => this.emit('drain'));
            stream.on('timeout', () => this.emit('timeout'));

            this.emit('connect');

            super.uncork();
            super.resume();
            this.emit('ready');
            typeof callback === 'function' && callback();
        });
    }

    _destroy() {
        this._stream && this._stream.destroy();
        this._socket.destroy();
    }

    cork() {
        if (this._socket) {
            this._socket.cork();
            super.cork();
        }
    }

    uncork() {
        if (this._socket) {
            this._socket.uncork();
            super.uncork();
        }
    }

    pause() {
        if (this._socket) {
            this._socket.pause();
            super.pause();
        }
    }

    resume() {
        if (this._socket) {
            this._socket.resume();
            super.resume();
        }
    }

    _write(data, encoding, callback) {
        assert(this._socket != undefined);
        return this._socket.write(data, encoding, callback);
    }

    _writev(chunks, callback) {
        chunks.map(({chunk, encoding}) => {
            return this._write(chunk, encoding, () => {});
        })
        callback();
    }

    _read(len) {
        if (!this._socket) {
            return null;
        }
        return this._socket.read(len);
    }

    setEncoding(encoding) {
        super.setEncoding(encoding);
    }

    setKeepAlive(enable, initialDelay) {
        return this;
    }

    setNoDelay(noDelay) {
        return this;
    }

    setTimeout(timeout, callback) {
        return this;
    }

    ref() {
        return this;
    }

    unref() {
        return this;
    }

}

export default SSHTransport;