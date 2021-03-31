import WebSocket from 'ws';
import net from 'net';
import querystring from 'querystring';
import url from 'url';
import Listener from '../listener/index.js';
import Transport from '../transport/index.js';
import TunnelManager from '../tunnel/tunnel-manager.js';
import { Logger } from '../logger.js'; const logger = Logger("ws-server");

class WebSocketEndpoint {

    static UPGRADE_TIMEOUT = 5000;

    constructor(opts) {
        this.opts = opts;
        this.httpListener = new Listener().getListener('http');
        this.tunnelManager = new TunnelManager();
        this.wss = new WebSocket.Server({ noServer: true });

        this.httpListener.use('upgrade', async (ctx, next) => {
            if (!await this.handleUpgrade(ctx.req, ctx.sock, ctx.head)) {
                next();
            }
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

    _unauthorized(sock) {
        this._rawHttpResponse(sock, 401, 'Unauthorized', '');
    };

    _rawHttpResponse(sock, code, codeString, body) {
        sock.write(`HTTP/1.1 ${code} ${codeString}\r\n\r\n`);
        sock.write(JSON.stringify(body));
        sock.destroy();
    }

    async handleUpgrade(req, sock, head) {
        if (req.upgrade !== true) {
            logger.trace("upgrade called on non-upgrade request");
            return false;
        }

        const tunnelId = this._getRequestTunnelId(req);
        const authToken = this._getRequestAuthToken(req);
        if (tunnelId === undefined || authToken === undefined) {
            this._unauthorized(sock);
            return true;
        }

        const tunnel = await this.tunnelManager.get(tunnelId);
        if (tunnel.authenticate(authToken) === false) {
            this._unauthorized(sock);
            return true;
        }

        if (tunnel.connected) {
            this._rawHttpResponse(sock, 503, 'Service unavailable', {
                error: 'tunnel already connected'
            });
        }

        const timeout = setTimeout(() => {
            logger.withContext("tunnel", tunnelId).debug(`HTTP upgrade on websocket timeout`);
            this._rawHttpResponse(sock, 504, `Timeout`, {
                error: 'HTTP upgrade timeout'
            })
        }, this.UPGRADE_TIMEOUT);

        this.wss.handleUpgrade(req, sock, head, (ws) => {
            clearTimeout(timeout);
            const transport = Transport.createTransport({
                method: 'WS',
                opts: {
                    tunnelId: tunnel.id,
                    socket: ws
                }
            });
            tunnel.setTransport(transport);
        });
        return true;
    }
}

export default WebSocketEndpoint;