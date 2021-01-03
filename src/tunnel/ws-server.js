import WebSocket from 'ws';
import net from 'net';
import querystring from 'querystring';
import url from 'url';
import Listener from '../listener/index.js';
import { Logger } from '../logger.js'; const logger = Logger("ws-server");

class WebSocketServer {
    constructor(opts) {
        this.opts = opts;
        this.httpListener = new Listener().getListener('http');
        this.tunnelManager = opts.tunnelManager;
        this.wss = new WebSocket.Server({ noServer: true });

        this.httpListener.use('request', async (ctx, next) => {
            if (!await this.handleRequest(ctx.req, ctx.res)) {
                next();
            }
        });

        this.httpListener.use('upgrade', async (ctx, next) => {
            await this.handleUpgrade(ctx.req, ctx.sock, ctx.head);
        });
    }

    _getTunnelId(hostname) {
        const host = hostname.toLowerCase().split(":")[0];
        const tunnelId = host.substr(0, host.indexOf(this.opts.subdomainUrl.hostname) - 1);
        return tunnelId !== '' ? tunnelId : undefined;
    }

    async _getTunnel(req) {
        const hostname = req.headers.host;
        if (hostname === undefined) {
            return;
        }

        const tunnelId = this._getTunnelId(hostname);
        if (tunnelId === undefined) {
            return;
        }

        const tunnel = await this.tunnelManager.get(tunnelId);
        return tunnel;
    }

    _clientIp(req) {
        let ip;
        if (req.headers['x-forwarder-for']) {
            ip = req.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
        }
        return net.isIP(ip) ? ip : req.socket.remoteAddress;
    }

    _unauthorized(sock) {
        sock.end(`HTTP/1.1 401 Unauthorized\r\n\r\n`);
    };

    _authenticate(req, tunnel) {
        const requestUrl = url.parse(req.url);
        const queryParams = querystring.decode(requestUrl.query);
        const token = queryParams['token'];
        return tunnel != undefined && tunnel.authenticate(token) === true;
    }

    async handleRequest(req, res) {
        const tunnel = await this._getTunnel(req);
        if (tunnel) {
            req.headers['x-forwarded-for'] = this._clientIp(req);
            req.headers['x-real-ip'] = req.headers['x-forwarded-for'];
            const wsTunnel = tunnel.tunnels['websocket'];
            if (wsTunnel) {
                wsTunnel.httpRequest(this.wss, req, res);
            } else {
                res.statusCode = 401;
            }
            return true
        } else {
            return false;
        }
    }

    async handleUpgrade(req, sock, head) {
        const tunnelConfig = await this._getTunnel(req);
        if (tunnelConfig == undefined) {
            return this._unauthorized(sock);
        }

        const tunnel = tunnelConfig.tunnels['websocket'];
        if (this._authenticate(req, tunnel) !== true) {
            return this._unauthorized(sock);
        }

        req.headers['x-forwarded-for'] = this._clientIp(req);
        req.headers['x-real-ip'] = req.headers['x-forwarded-for'];
        tunnel.httpRequest(this.wss, req, sock, head);
    }
}

export default WebSocketServer;