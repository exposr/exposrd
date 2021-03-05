import WebSocket from 'ws';
import net from 'net';
import querystring from 'querystring';
import url from 'url';
import Listener from '../listener/index.js';
import WebSocketTransport from '../transport/ws/ws-transport.js';
import TunnelManager from '../tunnel/tunnel-manager.js';
import { Logger } from '../logger.js'; const logger = Logger("ws-server");

class WebSocketEndpoint {
    constructor(opts) {
        this.opts = opts;
        this.httpListener = new Listener().getListener('http');
        this.tunnelManager = new TunnelManager();
        this.wss = new WebSocket.Server({ noServer: true });

        this.httpListener.use('upgrade', async (ctx, next) => {
            await this.handleUpgrade(ctx.req, ctx.sock, ctx.head);
        });
    }

    _getRequestTunnelId(req) {
        const hostname = req.headers.host;
        if (hostname === undefined) {
            return undefined;
        }
        const host = hostname.toLowerCase().split(":")[0];
        const tunnelId = host.substr(0, host.indexOf(this.opts.subdomainUrl.hostname) - 1);
        return tunnelId !== '' ? tunnelId : undefined;
    }

    _getRequestClientIp(req) {
        let ip;
        if (req.headers['x-forwarder-for']) {
            ip = req.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
        }
        return net.isIP(ip) ? ip : req.socket.remoteAddress;
    }

    _getRequestAuthToken(req) {
        const requestUrl = url.parse(req.url);
        const queryParams = querystring.decode(requestUrl.query);
        const token = queryParams['token'];
        return token;
    }

    async _connect(wss, req, sock, head) {
        const self = this;
        return new Promise((resolve, reject) => {
            if (req.upgrade !== true) {
                return reject("upgrade request expected");
            }

            const timeout = setTimeout(() => {
                reject("timeout");
            }, 1000);
            wss.handleUpgrade(req, sock, head, (ws) => {
                clearTimeout(timeout);
                const transport = new WebSocketTransport(ws)
                resolve(transport);
            });
        });
    }

    _unauthorized(sock) {
        sock.end(`HTTP/1.1 401 Unauthorized\r\n\r\n`);
    };

    async handleUpgrade(req, sock, head) {
        const tunnelId = this._getRequestTunnelId(req);
        const authToken = this._getRequestAuthToken(req);
        if (tunnelId === undefined || authToken === undefined) {
            this._unauthorized(sock);
            return;
        }

        const tunnel = await this.tunnelManager.get(tunnelId);
        if (tunnel.authenticate(authToken) === false) {
            this._unauthorized(sock);
            return;
        }

        const transport = await this._connect(this.wss, req, sock, head)
            .catch(err => {
                res.statusCode = 503;
                res.end(JSON.stringify({error: "tunnel not connected"}));
                return false;
            });

        tunnel.updateState(true, transport);
    }
}

export default WebSocketEndpoint;