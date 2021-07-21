import WebSocketTransport from "./ws/ws-transport.js"
import SSHTransport from "./ssh/ssh-transport.js";

class Transport {
    static createTransport(ctx) {
        if (ctx.method == 'WS') {
            return Transport.WebSocketTransportFactory(ctx.opts);
        } else if (ctx.method == 'SSH') {
            return Transport.SSHTransportFactory(ctx.opts);
        } else {
            throw new Error(`Unknown tunnel transport ${ctx.method}`)
        }
    };

    static WebSocketTransportFactory(opts) {
        const transport = new WebSocketTransport(opts);
        return transport;
    }

    static SSHTransportFactory(opts) {
        return new SSHTransport(opts);
    }
}

export default Transport;
