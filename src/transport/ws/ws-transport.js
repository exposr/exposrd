import WebSocketMultiplex from './ws-multiplex.js';
import WebSocketAgent from './ws-agent.js';

class WebSocketTransport {
    constructor(ws) {
        this.ws = ws;
        const multiplex = this.multiplex = new WebSocketMultiplex(ws);
        this.httpAgent = new WebSocketAgent(multiplex);
        ws.once('close', () => {
            multiplex.terminate();
            ws.terminate();
            this.multiplex = undefined;
        });
    }
}

export default WebSocketTransport;