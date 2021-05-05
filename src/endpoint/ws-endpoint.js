import WebSocket from 'ws';
import net from 'net';
import Listener from '../listener/index.js';
import Transport from '../transport/index.js';
import TunnelService from '../tunnel/tunnel-service.js';
import { Logger } from '../logger.js'; const logger = Logger("ws-endpoint");

class WebSocketEndpoint {

    static PATH = '/v1/endpoint/ws';

    static UPGRADE_TIMEOUT = 5000;

    constructor(opts) {
        this.opts = opts;
        this.httpListener = new Listener().getListener('http');
        this.tunnelService = new TunnelService();
        this.wss = new WebSocket.Server({ noServer: true });

        this.httpListener.use('upgrade', async (ctx, next) => {
            const response = await this.handleUpgrade(ctx.req, ctx.sock, ctx.head);
            if (response === undefined) {
                return next();
            }
            logger.info({
                request: {
                    path: ctx.req.url,
                    method: ctx.req.method,
                    headers: ctx.req.headers,
                },
                response
            });
            if (!response) {
                next();
            }
        });
    }

    _getRequestClientIp(req) {
        let ip;
        if (req.headers['x-forwarded-for']) {
            ip = req.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
        }
        return net.isIP(ip) ? ip : req.socket.remoteAddress;
    }

    _parseRequest(req) {
        let requestUrl;
        try {
            requestUrl = new URL(req.url, `http://${req.headers.host}`);
        } catch (err) {
            return undefined;
        }

        if (!requestUrl.pathname.startsWith(WebSocketEndpoint.PATH)) {
            return undefined;
        }

        const tunnelId = requestUrl.pathname.substr(WebSocketEndpoint.PATH.length + 1);
        const token = requestUrl.searchParams.get('token');
        return {
            tunnelId,
            token,
        };
    }

    _unauthorized(sock, request) {
        const response = {
            status: 401,
            statusLine: 'Unauthorized'
        }
        return this._rawHttpResponse(sock, request, response);
    };

    _rawHttpResponse(sock, request, response) {
        sock.write(`HTTP/${request.httpVersion} ${response.status} ${response.statusLine}\r\n`);
        sock.write('\r\n');
        response.body && sock.write(response.body);
        sock.destroy();
        return response;
    }

    async handleUpgrade(req, sock, head) {
        if (req.upgrade !== true) {
            logger.trace("upgrade called on non-upgrade request");
            return undefined;
        }

        const parsed = this._parseRequest(req);
        if (parsed == undefined) {
            return undefined;
        }

        const {tunnelId, token} = parsed;
        if (tunnelId === undefined || token === undefined) {
            return this._unauthorized(sock, req);
        }

        const tunnel = await this.tunnelService.get(tunnelId);
        if (tunnel?.endpoints?.ws?.token !== token) {
            return this._unauthorized(sock, req);
        }

        if (tunnel.connected) {
            return this._rawHttpResponse(sock, req, {
                status: 503,
                statusLine: 'Service unavailable',
                body: JSON.stringify({error: 'tunnel already connected'}),
            });
        }

        const timeout = setTimeout(() => {
            logger.withContext("tunnel", tunnelId).debug(`HTTP upgrade on websocket timeout`);
            this._rawHttpResponse(sock, req, {
                status: 504,
                statusLine: 'Timeout',
                body: JSON.stringify({error: 'websocket upgrade timeout'}),
            });
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
            const res = this.tunnelService.connect(tunnelId, transport, {
                peer: this._getRequestClientIp(req),
            });
            if (!res) {
                logger
                    .withContext("tunnel", tunnelId)
                    .error({
                        operation: 'upgrade',
                        msg: 'failed to connect transport'
                    });
                transport.destroy();
            }
        });
        return true;
    }
}

export default WebSocketEndpoint;