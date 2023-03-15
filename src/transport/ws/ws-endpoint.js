import net from 'net';
import querystring from 'querystring';
import { WebSocketServer } from 'ws';
import Listener from '../../listener/index.js';
import { Logger } from '../../logger.js';
import TunnelService from '../../tunnel/tunnel-service.js';
import Tunnel from '../../tunnel/tunnel.js';
import {
    ERROR_TUNNEL_ALREADY_CONNECTED,
    ERROR_TUNNEL_TRANSPORT_CON_TIMEOUT
} from '../../utils/errors.js';
import WebSocketTransport from './ws-transport.js';

class WebSocketEndpoint {

    static BASE_PATH = '/v1/tunnel';

    static PATH_MATCH = new RegExp(`${WebSocketEndpoint.BASE_PATH}\/([^/]+)/ws-endpoint`);

    static UPGRADE_TIMEOUT = 5000;

    constructor(opts) {
        this.opts = opts;
        this.logger = Logger("ws-endpoint");
        this.httpListener = Listener.acquire('http', opts.port);
        this.tunnelService = new TunnelService();
        this.wss = new WebSocketServer({ noServer: true });
        this.destroyed = false;

        this._upgradeHandler = this.httpListener.use('upgrade', { logger: this.logger }, async (ctx, next) => {
            if (!await this.handleUpgrade(ctx.req, ctx.sock, ctx.head)) {
                return next();
            }
        });

        this.httpListener.listen()
            .then(() => {
                typeof opts.callback === 'function' && opts.callback();
            })
            .catch((err) => {
                this.logger.error({
                    message: `Failed to initialize websocket transport connection endpoint: ${err}`,
                })
                typeof opts.callback === 'function' && opts.callback(err);
            });
    }

    getEndpoint(tunnel, baseUrl) {
        const url = new URL(baseUrl);
        url.protocol = baseUrl.protocol == 'https:' ? 'wss' : 'ws';
        url.pathname =  `${WebSocketEndpoint.BASE_PATH}/${tunnel.id}/ws-endpoint`;
        url.search = '?' + querystring.encode({t: tunnel.transport.token});
        return {
            url: url.href,
        };
    }

    async destroy() {
        this.destroyed = true;
        this.httpListener.removeHandler('upgrade', this._upgradeHandler);
        this.wss.clients.forEach((client) => {
            client.close();
        });
        return Promise.allSettled([
            this.tunnelService.destroy(),
            Listener.release('http', this.opts.port),
        ]);
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

        const match = requestUrl.pathname.match(WebSocketEndpoint.PATH_MATCH);
        if (!match) {
            return undefined;
        }

        const tunnelId = match[1];
        const token = requestUrl.searchParams.get('t');
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
            this.logger.trace("upgrade called on non-upgrade request");
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

        const authResult = await this.tunnelService.authorize(tunnelId, token);
        if (authResult.authorized == false) {
            authResult.error &&
                this.logger
                    .withContext("tunnel", tunnelId)
                    .error({
                        operation: 'upgrade',
                        message: authResult.error.message,
                        stack: authResult.error.stack,
                    });
            return this._unauthorized(sock, req);
        }

        const {tunnel, account} = authResult;

        if (tunnel.state().connected) {
            return this._rawHttpResponse(sock, req, {
                status: 503,
                statusLine: 'Service unavailable',
                body: JSON.stringify({error: ERROR_TUNNEL_ALREADY_CONNECTED}),
            });
        }

        const timeout = setTimeout(() => {
            this.logger.withContext("tunnel", tunnelId).debug(`HTTP upgrade on websocket timeout`);
            this._rawHttpResponse(sock, req, {
                status: 504,
                statusLine: 'Timeout',
                body: JSON.stringify({error: ERROR_TUNNEL_TRANSPORT_CON_TIMEOUT}),
            });
        }, this.UPGRADE_TIMEOUT);

        this.wss.handleUpgrade(req, sock, head, async (ws) => {
            clearTimeout(timeout);
            const transport = new WebSocketTransport({
                tunnelId: tunnel.id,
                socket: ws,
            })
            const res = await this.tunnelService.connect(tunnel.id, account.id, transport, {
                peer: this._getRequestClientIp(req),
            });
            if (!res) {
                this.logger
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