import WebSocketTransport from "./ws/ws-transport.js"

class Transport {
    static createTransport(ctx) {
        if (ctx.method == 'WS') {
            return new WebSocketTransport(ctx.opts);
        } else {
            throw new Error(`Unknown tunnel transport ${ctx.method}`)
        }

    };
}

export default Transport;
