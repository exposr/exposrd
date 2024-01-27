import assert from 'assert/strict';
import crypto from 'crypto';
import ssh from 'ssh2';
import tls from 'tls';
import { Duplex } from 'stream';
import { Logger } from '../../logger.js';
import TunnelService from '../../tunnel/tunnel-service.js';
import Tunnel from '../../tunnel/tunnel.js';
import Hostname from '../../utils/hostname.js';
import Transport, { TransportConnectionOptions, TransportOptions } from '../transport.js';
import { AddressInfo, SocketConnectOpts, SocketReadyState } from 'net';

export type SSHTransportOptions = TransportOptions & {
    tunnelId: string,
    target: string | URL | undefined,
    client: ssh.Connection,
    allowInsecureTarget: boolean,
};

class SSHTransport extends Transport {
    private logger: any;
    private _tunnelService: TunnelService;
    private _client: ssh.Connection;
    private _target: URL;
    private _bindaddr!: string;
    private allowInsecureTarget: boolean = false;
    private openSockets: Array<SSHTransportSocket> = [];

    constructor(opts: SSHTransportOptions) {
        super(opts);

        this.logger = Logger("ssh-transport");
        this._tunnelService = new TunnelService();
        const client = this._client = opts.client;

        if (opts.target instanceof URL) {
            this._target = opts.target;
        } else if (typeof opts.target == "string") {
            try {
                this._target = new URL(opts.target);
            } catch (e) {
                this._target = new URL("tcp://");
            }
        } else {
            this._target = new URL("tcp://");
        }

        this.allowInsecureTarget = opts.allowInsecureTarget;

        client.on('session', (accept, reject) => {
            const session = accept();
            session.on('pty', (accept, reject, info) => {
                accept();
            });
            session.on('shell', async (accept, reject) => {
                let tunnel: Tunnel;
                try {
                    tunnel = await this._tunnelService.lookup(opts.tunnelId);
                } catch (e) {
                    return reject();
                }
                const stream = accept();
                stream.write(`Target URL: ${this._target.href}\r\n`);

                const printIngress = (type: string, url: string | undefined) => {
                    if (!url) {
                        return;
                    }
                    stream.write(`${type.toUpperCase()} ingress: ${url}\r\n`);
                };

                if (tunnel.config.ingress.http.enabled) {
                    printIngress("http", tunnel.config.ingress.http.url);
                }
                if (tunnel.config.ingress.sni.enabled) {
                    printIngress("sni", tunnel.config.ingress.sni.url);
                }

                stream.on('eof', () => {
                    this.destroy();
                });

                stream.on('data', (data: Buffer) => {
                    if (data[0] == 0x03) {
                        this.destroy();
                    }
                })
            });
        });

        client.on('request', async (accept, reject, name, info) => {
            if (!accept || !reject) {
                return;
            }

            if (name !== 'tcpip-forward') {
                return reject();
            }

            let tunnel;
            try {
                tunnel = await this._tunnelService.lookup(opts.tunnelId);
                if (tunnel.id != opts.tunnelId) {
                    return reject();
                }
            } catch (e) {
                return reject();
            }

            const bindUrl = Hostname.parse(info.bindAddr, <any>info.bindPort);
            if (bindUrl && bindUrl.hostname != '' && bindUrl.port != '') {
                if (bindUrl.hostname != this._target.hostname || bindUrl.port != this._target.port) {
                    this._target.hostname = bindUrl.hostname;
                    this._target.port = bindUrl.port;
                    await this._tunnelService.update(tunnel.id, <string>tunnel.account, (tunnelConfig) => {
                        tunnelConfig.target.url = this._target.href;
                    });
                    this.logger.info({
                        operation: 'update-target',
                        target: this._target.href,
                    });
                }
            }
            this._bindaddr = info.bindAddr;

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

        client.on('error', (err: Error) => {
            this.destroy(err);
        });
    }

    public createConnection(opts: TransportConnectionOptions, callback: (err: Error | undefined, sock: Duplex) => void): Duplex {
        const sock = new SSHTransportSocket({
            client: this._client,
        });
        const connectOpts: SSHTransportSocketConnectOptions = {
            remoteAddr: opts.remoteAddr,
            target: this._target,
            bindaddr: this._bindaddr,
            allowInsecureTarget: this.allowInsecureTarget,
        };

        const connectError = (err: Error) => {
            callback(err, sock);
        };

        sock.once('error', connectError);
        sock.connect(connectOpts, () => {
            sock.off('error', connectError);
            this.openSockets.push(sock);
            sock.once('close', () => {
                this.openSockets = this.openSockets.filter((s) => s.id != sock.id);
            });
            callback(undefined, sock);
        });
        return sock;
    }

    async _destroy(): Promise<void> {
        for (const sock of this.openSockets) {
            sock.destroy();
        }
        await this._tunnelService.destroy();
        this._tunnelService = <any>undefined;
    }
}

type SSHTransportSocketOptions = {
    client: ssh.Connection,
}

type SSHTransportSocketConnectOptions = {
    remoteAddr: string,
    target: URL,
    bindaddr: string,
    allowInsecureTarget: boolean,
}

class SSHTransportSocket extends Duplex {
    public readonly id: string;
    public connecting: boolean;
    public pending: boolean;
    public readyState: SocketReadyState;
    public bytesWritten?: number;
    public bytesRead?: number;
    public bufferSize: number;
    private writeBuffer: Array<{ chunk: Buffer, encoding: BufferEncoding, callback: (error: Error | null | undefined) => void }>;
    private writer: (chunk: Buffer, encoding: BufferEncoding, callback: (error: Error | null | undefined) => void) => void;

    private readBuffer: Array<Buffer>;
    private readBufferSize: number;
    private wantData: boolean = false;
    private constructCallback: ((error?: Error | null | undefined) => void) | undefined;
    private _destroyed: boolean;
    private _client: ssh.Connection | undefined;
    private socket!: Duplex;
    private rawSocket!: Duplex | undefined;
    private timeout: number | undefined;
    private timeoutTimer?: NodeJS.Timeout;

    constructor(opts: SSHTransportSocketOptions) {
        super({
            defaultEncoding: 'binary',
        });

        this.id = crypto.randomUUID();
        this._destroyed = false;
        this.bufferSize = 0;
        this._destroyed = false;
        this.connecting = false;
        this.pending = true;
        this.readyState = "closed";
        this.constructCallback = undefined;
        this.bytesRead = 0;
        this.bytesWritten = 0;
        this.readBuffer = [];
        this.readBufferSize = 0;
        this.writeBuffer = [];
        this.writer = this.bufferedWriter;

        this._client = opts.client;

        this._client.once('end', () => {
            this.socket?.end();
        });

        this._client.once('close', () => {
            this.destroy();
        });

        this._client.once('error', (err) => {
            this.destroy(err);
        });
    }

    public toString() {
        return `<${SSHTransportSocket.name}  state=${this.readyState}>`;
    }

    public connect(options: SSHTransportSocketConnectOptions, connectCallback?: () => void): this;
    public connect(options: SocketConnectOpts, connectionListener?: (() => void) | undefined): this;
    public connect(port: number, host: string, connectionListener?: (() => void) | undefined): this;
    public connect(port: number, connectionListener?: (() => void) | undefined): this;
    public connect(path: string, connectionListener?: (() => void) | undefined): this;
    public connect(port: unknown, host?: unknown, connectionListener?: unknown): this {
        const options = typeof port == 'object' ? (port as SSHTransportSocketConnectOptions) : {} as SSHTransportSocketConnectOptions;

        const target = options.target;
        const bindaddr = options.bindaddr;

        this.readyState = "opening";
        this.connecting = true;
        this.cork();

        const connectionCallback = typeof host == 'function' ?
            (host as () => void) :
            (typeof connectionListener == 'function' ? (connectionListener as () => void) : undefined);
        typeof connectionCallback == 'function' && this.once('connect', connectionCallback);

        const connectPort = Hostname.getPort(target);
        this._client?.forwardOut(target.hostname, connectPort, options.remoteAddr, connectPort, async (err, stream) => {
            if (err) {
                this.destroy(err);
                return;
            }

            let socket: Duplex = stream;

            const isTLS = Hostname.isTLS(target);
            let tlsSock: tls.TLSSocket;
            if (isTLS) {
                const tlsOpts: tls.ConnectionOptions = {
                    servername: target.hostname,
                    socket: stream,
                };
                if (options.allowInsecureTarget) {
                    tlsOpts['checkServerIdentity'] = () => undefined;
                    tlsOpts['rejectUnauthorized'] = false;
                }

                try {
                    tlsSock = await new Promise((resolve, reject) => {
                        const tlsSock = tls.connect(tlsOpts, () => {
                            resolve(tlsSock);
                        });
                        tlsSock.once('error', (err: Error) => {
                            reject(err);
                        });
                    });
                } catch (e: any) {
                    this.destroy(e);
                    return;
                }

                socket.once('error', (err: Error) => {
                    this.destroy(err)
                });

                socket.once('close', () => {
                    this.destroy();
                });

                this.rawSocket = socket;
                socket = tlsSock;
            }

            socket.on('data', (data: Buffer) => {
                this.readBuffer.push(data);
                this.readBufferSize += data.length;
                if (this.wantData) {
                    this.flush();
                }
            });

            socket.on('end', () => {
                this.end()
            });

            socket.on('close', () => {
                this.destroy();
            });

            socket.on('error', (err: Error) => {
                this.destroy(err);
            });

            this.socket = socket;
            this.connecting = false;
            this.pending = false;
            this.readyState = "open";

            this.flushWriteBuffer();
            this.writer = this.socket.write.bind(this.socket);

            typeof this.constructCallback == 'function' && this.constructCallback();
            this.emit('connect');
            this.emit('ready');
        });

        return this;
    }

    public resetAndDestroy(): this {
        return this.destroy();
    }

    public address(): {} | AddressInfo {
        return {};
    }

    public ref(): this {
        return this;
    }

    public unref(): this {
        return this;
    }

    _construct(callback: (error?: Error | null | undefined) => void): void {
        this.constructCallback = callback;
    }

    _destroy(error: Error | null, callback: (error: Error | null) => void): void {
        if (this._destroyed) {
            callback(error);
            return;
        }
        clearTimeout(this.timeoutTimer);
        this._destroyed = true;
        this.readyState = "closed";
        this.socket?.destroy(<any>error);
        this.socket?.removeAllListeners();
        this.socket = <any>undefined;
        this.rawSocket?.destroy(<any>error);
        this.rawSocket?.removeAllListeners();
        this.rawSocket = <any>undefined;
        try {
            this._client?.end();
            this._client = undefined;
        } catch (e) {}
        typeof callback === 'function' && callback(error);
    }

    private bufferedWriter(chunk: Buffer, encoding: BufferEncoding , callback: (error: Error | null | undefined) => void): void {
        const data = { chunk, encoding };
        this.writeBuffer.push({chunk, encoding, callback});
    }

    private flushWriteBuffer(): void {
        while (true) {
            const buffer = this.writeBuffer.shift();
            if (!buffer) {
                break;
            }
            this.socket.write(buffer.chunk, buffer.encoding, buffer.callback);
        }
    }

    _write(data: Buffer, encoding: BufferEncoding, callback: (error: Error | null | undefined) => void): void {
        assert(this._destroyed == false, "_write on destroyed");
        this.writer(data, encoding, callback);
        this.resetTimeout();
    }

    _writev(chunks: Array<{ chunk: any; encoding: BufferEncoding; }>, callback: (error: Error | null | undefined) => void): void {
        for (let i = 0; i < (chunks.length - 1); i++) {
            const {chunk, encoding} = chunks[i];
            this.writer(chunk, encoding, () => undefined);
        }
        const {chunk, encoding} = chunks[chunks.length - 1];
        this.writer(chunk, encoding, callback);
        this.resetTimeout();
    }

    private flush(): void {
        try {
            while (true) {
                const data = this.readBuffer.shift();
                if (!data) {
                    break;
                }
                this.readBufferSize -= data.length;
                const res = this.push(data);
                this.wantData = res;
                if (!res) {
                    break;
                }
            }
        } catch (err: any) {
            this.destroy(err);
        }
    }

    _read(size: number): void {
        this.wantData = true;
        if (this.readBufferSize > 0) {
            this.flush();
        }

        this.socket.read(size);
    }

    public setEncoding(encoding: BufferEncoding): this {
        super.setEncoding(encoding);
        return this;
    }

    public setKeepAlive(enable: boolean, initialDelay: number): this {
        return this;
    }

    public setNoDelay(noDelay: boolean): this {
        return this;
    }

    private resetTimeout(): void {
        clearTimeout(this.timeoutTimer);
        if (this.timeout != undefined && this.timeout > 0) {
            this.timeoutTimer = setTimeout(() => {
                this.emit('timeout');
            }, this.timeout);
        }
    }

    public setTimeout(timeout: number, callback?: () => void | undefined): this {
        this.timeout = timeout;
        typeof callback == 'function' && this.once('timeout', callback);
        if (this.readyState == 'open') {
            this.resetTimeout();
        }
        return this;
    }
}

export default SSHTransport;