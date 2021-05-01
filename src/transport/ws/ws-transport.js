import WebSocket from 'ws';
import { Duplex } from 'stream';
import { EventEmitter } from 'events';
import assert from 'assert/strict';
import { Logger } from '../../logger.js';
import { ECONNREFUSED, EINPROGRESS, EMFILE, ETIMEDOUT, EPIPE } from 'constants';
import CustomError from '../../utils/errors.js';

// Multiplexes multiple streams over one websocket connection
// Bi-directional channel creation.
//
// Frame format
// 0        2     4        8       12
// [VERSION][TYPE][CHANNEL][LENGTH][DATA...]
//
class WebSocketTransport extends EventEmitter {
    static MAX_CHANNELS = 65536;

    static MESSAGE_DATA = 1;
    static MESSAGE_CON = 2;
    static MESSAGE_CONACK = 3;
    static MESSAGE_FIN = 4;
    static MESSAGE_PAUSE = 5;
    static MESSAGE_RESUME = 6;

    static packetTraceEnabled = false;
    _packetTrace(dir, channel, type, length) {
        WebSocketTransport.packetTraceEnabled &&
            this.logger.trace(`PKT ${dir} : ch=${channel} type=${type} length=${length}`);
    }

    constructor(opts) {
        super();
        this._socket = opts.socket;
        assert(this._socket !== undefined);
        this._tunnelId = opts.tunnelId;
        this._socketStream = WebSocket.createWebSocketStream(this._socket, {
            objectMode: false,
            readableObjectMode: false,
            writableObjectMode: false,
            setDefaultEncoding: 'binary'
        });

        this.openSockets = {};
        this._eventBus = new EventEmitter();
        this.logger = Logger("ws-transport")
        this.logger.addContext("tunnel", this._tunnelId);

        this._socketStream.on('data', (chunk) => {
            const {header, data} = this._decodeMessage(chunk);
            this._packetTrace('<', header.channel, header.type, header.length);
            this._parseMessage(header, data);
        });

        this._socket.once('close', () => {
            this.destroy();
        });

        this._socket.on('pong', () => {
            this._alive = true;
        });
        this._alive = true;
        this._keepAlive = setInterval(() => {
            if (this._alive === false) {
                this.logger.info("No heartbeat for 30000ms");
                return this.destroy();
            }
            this._alive = false;
            this._socket.ping();
        }, 30000);

        this.maxChannels = opts.maxChannels || WebSocketTransport.MAX_CHANNELS;
        this.channelId = 0;
    }

    _decodeMessage(chunk) {
        const headerBuffer = chunk.slice(0, 12);
        const data = chunk.slice(12);
        const header = {
            version: headerBuffer.readUInt16BE(0),
            type: headerBuffer.readUInt16BE(2),
            channel: headerBuffer.readUInt32BE(4),
            length: headerBuffer.readUInt32BE(8),
        };
        return {header, data};
    }

    _encodeMessage(type, channel, data) {
        const header = Buffer.alloc(12);
        header.writeUInt16BE(1, 0)
        header.writeUInt16BE(type, 2);
        header.writeUInt32BE(channel, 4);
        header.writeUInt32BE(data !== undefined ? data.length : 0, 8);
        if (data != undefined) {
            return Buffer.concat([header, data]);
        } else {
            return header;
        }
    }

    _parseMessage(header, data) {
        if (header.type === WebSocketTransport.MESSAGE_DATA) {
            this._channelData(header.channel, data, header.length);
        } else if (header.type === WebSocketTransport.MESSAGE_CON) {
            this._eventBus.emit('connect', header.channel);
        } else if (header.type === WebSocketTransport.MESSAGE_CONACK) {
            this._eventBus.emit(`ack-${header.channel}`, header.channel);
        } else if (header.type === WebSocketTransport.MESSAGE_FIN) {
            this._eventBus.emit(`fin-${header.channel}`, header.channel);
        } else if (header.type === WebSocketTransport.MESSAGE_PAUSE) {
            this._pauseChannel(header.channel);
        } else if (header.type === WebSocketTransport.MESSAGE_RESUME) {
            this._resumeChannel(header.channel);
        } else {
            this.logger.debug(`Unknown type ${header.type} header=${JSON.stringify(header)}`)
        }
    }

    _sendMessage(type, channel, data = undefined, callback) {
        assert(channel !== undefined);
        if (this._socket.readyState !== WebSocket.OPEN) {
            return callback(new CustomError(EPIPE, `transport closed`));
        }

        const message = this._encodeMessage(type, channel, data);

        try {
            this._packetTrace('>', channel, type, data != undefined ? data.length : 0);
            this._socket.send(message, callback);
            return true;
        } catch (err) {
            callback(err);
            return false;
        }
    }

    _channelData(fd, data, length) {
        const socket = this.openSockets[fd];
        if (socket === undefined) {
            this.logger.debug(`data on non-connected channel fd=${fd}`)
            this.logger.isTraceEnabled() &&
                this.logger.trace({
                    msg: 'data on non-connected channel',
                    fd,
                    length,
                    data
                });
            this._sendMessage(WebSocketTransport.MESSAGE_FIN, fd, undefined, () => {})
            return;
        }
        const result = socket.push(data);
        if (!result) {
            socket.pause();
        }
    }

    _pauseChannel(fd) {
        const socket = this.openSockets[fd];
        if (!socket) {
            return;
        }
        socket.cork();
    }

    _resumeChannel(fd) {
        const socket = this.openSockets[fd];
        if (!socket) {
            return;
        }
        socket.uncork();
    }

    _pauseRemoteChannel(sock, callback) {
        assert(sock !== undefined);
        const fd = sock.fd;
        assert(fd !== undefined);
        this._sendMessage(WebSocketTransport.MESSAGE_PAUSE, fd, undefined, callback);
    }

    _resumeRemoteChannel(sock, callback) {
        assert(sock !== undefined);
        const fd = sock.fd;
        assert(fd !== undefined);
        this._sendMessage(WebSocketTransport.MESSAGE_RESUME, fd, undefined, callback);
    }

    _send(sock, data, callback) {
        assert(sock !== undefined);
        const fd = sock.fd;
        assert(fd !== undefined);
        return this._sendMessage(WebSocketTransport.MESSAGE_DATA, fd, data, callback);
    }

    async _openChannel(sock, timeout, callback) {
        assert(sock !== undefined);
        if (sock.fd === undefined) {
            sock.fd = await this._getChannelId(1000);
            if (sock.fd == undefined) {
                return callback(new CustomError(EMFILE, `No channels free (${this.maxChannels})`));
            }
        }

        const fd = sock.fd;
        this.openSockets[fd] = sock;

        let connectTimeout;

        const handle = (err) => {
            this._eventBus.removeAllListeners(`ack-${fd}`);
            this._eventBus.removeAllListeners(`fin-${fd}`);
            connectTimeout && clearTimeout(connectTimeout);
            if (!err) {
                this._eventBus.once(`fin-${fd}`, (fd) => {
                    sock.destroy();
                });
            } else {
                this._destroy(fd);
            }
            callback(err);
        };

        this._sendMessage(WebSocketTransport.MESSAGE_CON, fd, undefined, (err) => {
            if (err) {
                return callback(err);
            }
            this._eventBus.once(`ack-${fd}`, (fd) => {
                handle();
            });
            this._eventBus.once(`fin-${fd}`, (fd) => {
                handle(new CustomError(ECONNREFUSED, `connection refused fd=${fd}`));
            });
            connectTimeout = setTimeout(() => {
                handle(new CustomError(ETIMEDOUT, `connection timeout fd=${fd}`));
            }, timeout);
        });
    }

    _closeChannel(sock, callback) {
        assert(sock !== undefined);
        const fd = sock.fd;
        assert(sock !== undefined);
        this._sendMessage(WebSocketTransport.MESSAGE_FIN, fd, undefined, () => {
            this._destroy(fd);
            callback();
        });
    }

    _destroy(fd) {
        this._eventBus.removeAllListeners(`ack-${fd}`);
        this._eventBus.removeAllListeners(`fin-${fd}`);
        delete this.openSockets[fd];
        this._eventBus.emit('close', fd);
    }

    async _getChannelId(timeout) {

        if (Object.keys(this.openSockets).length >= this.maxChannels) {
            const startWait = process.hrtime.bigint();
            await new Promise((resolve) => {
                const onEvent = () => {
                    clearTimeout(onTimer);
                    this._eventBus.removeListener('close', onEvent)
                    resolve();
                }
                const onTimer = setTimeout(onEvent, timeout);
                this._eventBus.once('close', onEvent);
            });
            const elapsedMs = Number((process.hrtime.bigint() - BigInt(startWait))) / 1e6;

            if (Object.keys(this.openSockets).length >= this.maxChannels) {
                timeout -= elapsedMs;
                return timeout > 0 ? this._getChannelId(timeout) : undefined;
            } else {
                return undefined;
            }
        }

        let nextChannel = this.channelId;
        for (let i = 0; i < this.maxChannels; i++) {
            if (this.openSockets[nextChannel] === undefined) {
                this.channelId = (nextChannel + 1) % this.maxChannels;
                return nextChannel;
            }
            nextChannel = (nextChannel + 1) % this.maxChannels;
        }

        return undefined;
    }

    _createSock(opts = {}) {
        const self = this;
        const sock = new WebSocketTransportSocket({
            ...opts,
            open: async (sock, timeout, cb) => { return this._openChannel(sock, timeout, cb); },
            close: (sock, cb) => { return this._closeChannel(sock, cb); },
            send: (sock, chunk, cb) => { return this._send(sock, chunk, cb); },
            pause: (sock, cb) => { return this._pauseRemoteChannel(sock, cb); },
            resume: (sock, cb) => { return this._resumeRemoteChannel(sock, cb); },
            logger: self.logger,
        });
        return sock;
    }

    createConnection(opts = {}, callback) {
        const sock = this._createSock();
        sock.connect(opts, callback);
        return sock;
    }

    listen(callback) {
        this._eventBus.on('connect', (fd) => {
            if (this.openSockets[fd] !== undefined) {
                if (this.openSockets[fd].state == WebSocketTransportSocket.OPEN) {
                    return;
                } else {
                    this.openSockets[fd].fd = undefined;
                    this.openSockets[fd].destroy();
                    this._destroy(fd);
                }
            }

            if (Object.keys(this.openSockets).length < this.maxChannels) {
                this._sendMessage(WebSocketTransport.MESSAGE_CONACK, fd, undefined, () => {
                    const sock = this._createSock({fd: fd});
                    this.openSockets[fd] = sock;
                    callback(sock);
                });
            } else {
                this.logger.debug(`connection attempt on fd=${fd} rejected, at limit (${this.maxChannels})`);
                this._sendMessage(WebSocketTransport.MESSAGE_FIN, fd, undefined, () => {});
            }
        });
    }

    close() {
        this._eventBus.removeAllListeners('connect');
    }

    destroy() {
        this.logger.debug(`transport destroy, open_sockets=${Object.keys(this.openSockets).length}`);
        Object.keys(this.openSockets).forEach((fd) => {
            const sock = this.openSockets[fd];
            sock.destroy();
        });
        this._keepAlive && clearInterval(this._keepAlive);
        this._keepAlive = false;
        this._eventBus.removeAllListeners('connect');
        this._socketStream.removeAllListeners('data');
        this._socketStream.destroy();
        this._socket.removeAllListeners('close');
        this._socket.removeAllListeners('pong');
        this._socket.close();
        this.destroyed = true;
        this.emit('close');
    }
}

export default WebSocketTransport;

// Exposes one multiplexed channel as a socket interface
class WebSocketTransportSocket extends Duplex {

    static CONNECTING = 'connecting';
    static PENDING = 'pending';
    static PAUSED = 'paused';
    static OPEN = 'open';
    static HALFOPEN = 'halfopen';
    static ENDED = 'ended';

    constructor(opts) {
        super({
            setDefaultEncoding: 'binary'
        });
        this.remote = {
            open: opts.open,
            close: opts.close,
            send: opts.send,
            pause: opts.pause,
            resume: opts.resume
        }
        this.logger = opts.logger;
        this.fd = opts.fd;
        this.state = undefined;
        this.connecting = false;
        this.destroyed = false;
        this.pending = true;
        this.readyState = undefined;
        this.bytesRead = 0;
        this.bytesWritten = 0;

        if (this.fd !== undefined) {
            this.state = WebSocketTransportSocket.PENDING;
        }

        this.cork();

        this.logger.isTraceEnabled() && this.logger.trace(`new socket fd=${this.fd} state=${this.state}`);
    }

    connect(opts = {}, callback = undefined) {
        if (this.state === WebSocketTransportSocket.CONNECTING) {
            callback(new CustomError(EINPROGRESS, `connection already in progress`));
            return;
        }
        this.connecting = true;
        this.readyState = "opening";
        this.state = WebSocketTransportSocket.CONNECTING;
        if (typeof callback === 'function') {
            this.once('connect', () => {
                callback();
            });
        }
        this.remote.open(this, 1000, (err) => {
            if (this.state !== WebSocketTransportSocket.CONNECTING) {
                return;
            }
            this.logger.isTraceEnabled() && this.logger.trace(`connect fd=${this.fd} err=${err}`);
            this.connecting = false;
            this.pending = false;
            if (!err) {
                this.emit('connect');
                this._ready();
            } else {
                typeof callback === 'function' && this.removeListener('connect', callback);
                this.readyState = undefined;
                this._close(err);
            }
        });
    }

    accept() {
        this._ready();
    }

    _ready() {
        this.readyState = "open";
        this.state = WebSocketTransportSocket.OPEN;
        this.emit('ready');
        this.uncork();
        this.resume();
        this.logger.isTraceEnabled() && this.logger.trace(`_ready fd=${this.fd} paused=${this.isPaused()}`);
    }

    _close(err) {
        this.logger.isTraceEnabled() && this.logger.trace(`_close fd=${this.fd} state=${this.state} err=${err}`);
        if (err) {
            this.emit('error', err);
        }
        this.emit('close', err != undefined);
        this.readyState = undefined;
        this.state = WebSocketTransportSocket.ENDED;
        this.wasFd = this.fd;
        this.fd = undefined;
    }

    _destroy(error, callback) {
        this.logger.isTraceEnabled() && this.logger.trace(`destroy fd=${this.fd} state=${this.state} err=${error}`);

        if (this.fd !== undefined) {
            this.remote.close(this, () => {
                this._close(error);
                this.destroyed = true;
                typeof callback === 'function' && callback();
            });
        } else {
            this.destroyed = true;
            this._close(error);
            typeof callback === 'function' && callback();
        }
    }

    end(data, encoding, callback) {
        super.end(data, encoding, () => {
            if (this.destroyed) {
                typeof callback === 'function' && callback();
                return;
            }
            this.readyState = "readOnly";
            this.state = WebSocketTransportSocket.HALFOPEN;
            this.remote.close(this, () => {
                typeof callback === 'function' && callback();
            });
        });

        return this;
    }

    push(chunk, encoding) {
        this.bytesRead += chunk.length;
        return super.push(chunk, encoding);
    }

    pause() {
        if (this.state === WebSocketTransportSocket.OPEN) {
            this.state = WebSocketTransportSocket.PAUSED;
            super.pause();
            this.remote.pause(this, () => {
            });
        } else {
            super.pause();
        }
    }

    resume() {
        if (this.state === WebSocketTransportSocket.PAUSED) {
            this.state = WebSocketTransportSocket.OPEN;
            this.remote.resume(this, () => {
                super.resume();
            });
        } else if (this.state === WebSocketTransportSocket.OPEN) {
            super.resume();
        }
    }

    cork() {
        super.cork();
    }

    uncork() {
        if (this.state === WebSocketTransportSocket.OPEN) {
            super.uncork();
        }
    }

    _write(data, encoding, callback) {
        const buffer = Buffer.from(data, encoding);
        this.bytesWritten += data.length;
        return this.remote.send(this, buffer, callback);
    }

    _writev(chunks, callback) {
        chunks.map(({chunk, encoding}) => {
            return this._write(chunk, encoding, () => {});
        })
        callback();
    }

    _read(size) {
        this.resume();
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