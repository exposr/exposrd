import WebSocket from 'ws';
import { Duplex } from 'stream';
import { EventEmitter } from 'events';

const MESSAGE_DATA = 1;
const MESSAGE_CON = 2;
const MESSAGE_CONACK = 3;
const MESSAGE_NACK = 4;
const MESSAGE_FIN = 5;
const MESSAGE_PAUSE = 6;
const MESSAGE_RESUME = 6;

const STATE_INIT = 0;
const STATE_OPEN = 1;
const STATE_CON = 2;
const STATE_CONACK = 3;
const STATE_PAUSED = 4;

// Multiplexes multiple streams over one websocket connection
//
// Frame format
// 4      4        8
// [TYPE][CHANNEL][LENGTH][DATA...]
class WebSocketMultiplex extends EventEmitter {

    constructor(ws) {
        super();
        this.webSocket = ws;
        this.webSocketStream = WebSocket.createWebSocketStream(ws, {
            objectMode: false,
            readableObjectMode: false,
            writableObjectMode: false,
            setDefaultEncoding: 'binary'
        });
        this.channels = {};
        this._initialize();
    }

    terminate() {
        this.webSocketStream.end(null);
        this.channels = {};
    }

    _decodeMessage(chunk) {
        const headerBuffer = chunk.slice(0, 16);
        const data = chunk.slice(16);
        const header = {
            type: headerBuffer.readUInt32BE(0),
            channel: headerBuffer.readUInt32BE(4),
            length: headerBuffer.readUInt32BE(8),
        };
        return {header, data};
    }

    _encodeMessage(type, channel, data) {
        const header = Buffer.alloc(16);
        header.writeUInt32BE(type, 0);
        header.writeUInt32BE(channel, 4);
        header.writeUInt32BE(data !== undefined ? data.length : 0, 8);
        if (data != undefined) {
            return Buffer.concat([header, data]);
        } else {
            return header;
        }
    }

    _parseMessage(header, data) {
        if (header.type === MESSAGE_DATA) {
            this._channelData(header.channel, data, header.length);
        } else if (header.type === MESSAGE_CON) {
            this._channelConnect(header.channel);
        } else if (header.type === MESSAGE_CONACK) {
            this._channelOpen(header.channel);
        } else if (header.type === MESSAGE_NACK) {
            this._closeChannel(header.channel);
        } else if (header.type === MESSAGE_FIN) {
            this._closeChannel(header.channel);
        } else if (header.type === MESSAGE_PAUSE) {
            this._pauseChannel(header.channel);
        } else if (header.type === MESSAGE_RESUME) {
            this._resumeChannel(header.channel);
        } else {
            console.log(`Unknown type ${header.type} header=${header}`)
        }
    }

    _sendMessage(type, channel, data = undefined, callback) {
        const message = this._encodeMessage(type, channel, data);
        const stream = this.webSocketStream;
        try {
            const success = stream.write(message);
            if (!success) {
                stream.once('drain', callback);
            } else {
                process.nextTick(callback);
            }
        } catch (err) {
            this.emit("error", err);
        }
    }

    _initialize() {
        this.webSocketStream.on('data', (chunk) => {
            const {header, data} = this._decodeMessage(chunk);
            this._parseMessage(header, data);
        });
    }

    _channelData(channelId, data, length) {
        const channel = this.channels[channelId];
        if (channel === undefined) {
            return;
        }
        const result = channel.stream.push(data);
        if (!result) {
            this._pauseRemoteChannel(channelId);
        }
    }

    _pauseChannel(channelId) {
        const channel = this.channels[channelId];
        if (!channel) {
            return;
        }
        channel.stream.pause();
    }

    _resumeChannel(channelId) {
        const channel = this.channels[channelId];
        if (!channel) {
            return;
        }
        channel.stream.resume();
    }

    _pauseRemoteChannel(channelId) {
        const channel = this.channels[channelId];
        if (!channel) {
            return;
        }

        if (channel.state !== STATE_OPEN || channel.state === STATE_PAUSED) {
            return;
        }

        this._sendMessage(MESSAGE_PAUSE, channelId, undefined, () => {
            channel.state = STATE_PAUSED;
        });
    }

    _resumeRemoteChannel(channelId) {
        const channel = this.channels[channelId];
        if (!channel || channel.state !== STATE_PAUSED) {
            return;
        }
        this._sendMessage(MESSAGE_RESUME, channel, undefined, () => {
            channel.state = STATE_OPEN;
        });
    }

    _channelOpen(channelId) {
        const channel = this.channels[channelId];
        const cb = () => {
            channel.state = STATE_OPEN;
            channel.stream.resume();
            this.emit('open', channelId, channel.stream);
        };
        if (channel.state == STATE_CON) {
            this._sendMessage(MESSAGE_CONACK, channelId, undefined, cb);
        } else if (channel.state == STATE_CONACK) {
            if (channel._conTimeout) {
                clearTimeout(channel._conTimeout);
                channel._conTimeout = undefined;
            }
            cb();
        }
    }

    _channelConnect(channelId) {
        if (this.channels[channelId]) {
            return;
        }
        const channel = this._setupChannel(channelId);
        channel.state = STATE_CON;
        this.emit('connect', channelId);
    }

    _establishRemoteChannel(channelId, timeout) {
        const channel = this._setupChannel(channelId);

        this._sendMessage(MESSAGE_CON, channelId, undefined, () => {
            channel.state = STATE_CONACK;
        });
        this.channels[channelId]._conTimeout = setTimeout(() => {
            delete this.channels[channelId];
            this.emit('error', channelId, new Error('timeout'));
        }, timeout);
    }

    _setupChannel(channelId) {
        const self = this;
        const readFn = (size) => {
            this._resumeRemoteChannel(channelId);
        };

        const writeFn = (chunk, encoding, callback) => {
            return this._sendMessage(MESSAGE_DATA, channelId, chunk, callback);
        };

        const channelStream = new Duplex({
            read: readFn,
            write: writeFn,
            setDefaultEncoding: 'binary'
        });

        channelStream.on('finish', () => {
            this._closeChannel(channelId);
        });

        channelStream.on('drain', () => {
            this._resumeRemoteChannel(channelId);
        });

        channelStream.pause();

        const channel = this.channels[channelId] = {
            state: STATE_INIT,
            channelId: channelId,
            stream: channelStream,
            remotePaused: false,
        };
        return channel;
    }

    _closeChannel(channelId) {
        const channel = this.channels[channelId];
        if (!channel) {
            return;
        }

        channel.stream.end();
        if (channel._conTimeout) {
            clearTimeout(channel._conTimeout);
            channel._conTimeout = undefined;
        }

        const cb = () => {
            delete this.channels[channelId];
            this.emit('close', channelId);
        }

        if (channel.state == STATE_CON) {
            this._sendMessage(MESSAGE_NACK, channelId, undefined, cb);
        } else if (channel.state == STATE_CONACK) {
            this.emit('error', channelId, new Error('connection nack'));
            cb();
        } else {
            this._sendMessage(MESSAGE_FIN, channelId, undefined, cb);
        }
    }

    open(channelId, timeout = 1000) {
        const channel = this.channels[channelId];
        if (!channel) {
            this._establishRemoteChannel(channelId, timeout);
        } else {
            this._channelOpen(channelId);
        }
    }

    close(channelId) {
        this._closeChannel(channelId);
    }

}

export default WebSocketMultiplex;