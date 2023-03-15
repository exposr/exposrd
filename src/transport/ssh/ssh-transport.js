import assert from 'assert/strict';
import { Duplex } from 'stream';
import tls from 'tls';
import { Logger } from '../../logger.js';
import TunnelService from '../../tunnel/tunnel-service.js';
import Tunnel from '../../tunnel/tunnel.js';
import Hostname from '../../utils/hostname.js';
import Transport from '../transport.js';

class SSHTransport extends Transport {
    constructor(opts) {
        super();

        this.logger = Logger("ssh-transport");
        this._tunnelService = new TunnelService();
        const client = this._client = opts.client;

        try {
            this._target = new URL(opts.target);
        } catch (e) {
            this._target = new URL("tcp://");
        }

        client.on('session', (accept, reject) => {
            const session = accept();
            session.on('pty', (accept, reject, info) => {
                accept();
            });
            session.on('shell', async (accept, reject) => {
                const tunnel = await this._tunnelService.lookup(opts.tunnelId);
                if (!(tunnel instanceof Tunnel) || tunnel.id != opts.tunnelId) {
                    return reject();
                }
                const stream = accept();
                stream.write(`Target URL: ${this._target.href}\r\n`);
                Object.keys(tunnel.ingress).forEach((ing) => {
                    if (!tunnel.ingress[ing].enabled) {
                        return;
                    }
                    tunnel.ingress[ing]?.urls?.forEach((url) => {
                        stream.write(`${ing.toUpperCase()} ingress: ${url}\r\n`);
                    });
                });

                stream.on('data', (data) => {
                    if (data[0] == 0x03) {
                        this.destroy();
                    }
                })
            });
        });

        client.on('request', async (accept, reject, name, info) => {
            if (name !== 'tcpip-forward') {
                return reject();
            }

            const tunnel = await this._tunnelService.lookup(opts.tunnelId);
            if (!(tunnel instanceof Tunnel) || tunnel.id != opts.tunnelId) {
                return reject();
            }

            const bindUrl = this._bindaddr = Hostname.parse(info.bindAddr, info.bindPort);
            if (bindUrl && bindUrl.hostname != 'localhost') {
                if (bindUrl.href != this._target.href) {
                    this._target = bindUrl;
                    this._tunnelService.update(tunnel.id, tunnel.account, (tunnel) => {
                        tunnel.target.url = bindUrl.href;
                    });
                    this.logger.info({
                        operation: 'update-target',
                        target: bindUrl.href,
                    });
                }
            }

            const port = Hostname.getPort(this._target);
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
            target: this._target,
            bindaddr: this._bindaddr,
        });
        sock.connect(callback);
        return sock;
    }

    async destroy() {
        if (this.destroyed) {
            return;
        }
        this._client.end();
        this.destroyed = true;
        this.emit('close');
        return this._tunnelService.destroy();
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
        this._target = opts.target;
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

        const port = Hostname.getPort(this._target);
        this._client.forwardOut(this._bindaddr.hostname, port, this._target.hostname, port, (err, stream) => {
            this.connecting = false;
            if (err) {
                typeof callback === 'function' && this.removeListener('connect', callback);
                this.readyState = undefined;
                this.emit('close', err);
                return;
            }

            this._stream = stream;
            const isTLS = Hostname.isTLS(this._target);
            if (isTLS) {
                const tlsSock = tls.connect({
                    servername: this._target.hostname,
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