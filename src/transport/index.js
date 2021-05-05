import WebSocketTransport from "./ws/ws-transport.js"

class Transport {
    static createTransport(ctx) {
        if (ctx.method == 'WS') {
            return Transport.WebSocketTransportFactory(ctx.opts);
        } else {
            throw new Error(`Unknown tunnel transport ${ctx.method}`)
        }
    };

    static WebSocketTransportFactory(opts) {
        const transport = new WebSocketTransport(opts);
        return transport;
    }
}

export default Transport;
