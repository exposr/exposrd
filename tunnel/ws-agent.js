import { Agent } from 'http';

class WebSocketAgent extends Agent {

    constructor(wsMultiplex) {
        super();
        this.channelId = 0;
        this.multiplex = wsMultiplex;
        this.pendingCallbacks = {};

        this.multiplex.on('open', (channelId, stream) => {
            const callback = this.pendingCallbacks[channelId];
            delete this.pendingCallbacks[channelId];
            callback(undefined, stream);
        });
        this.multiplex.on('error', (channelId, err) => {
            const callback = this.pendingCallbacks[channelId];
            delete this.pendingCallbacks[channelId];
            callback(err);
        });
    }

    // TODO: fixme
    _getChannelId = () => {
        this.channelId = (this.channelId + 1) % 4294967295;
        return this.channelId;
    }

    createConnection(options, callback) {
        const channelId = this._getChannelId();
        this.pendingCallbacks[channelId] = callback;
        this.multiplex.open(channelId, 5000);
    }

}

export default WebSocketAgent;