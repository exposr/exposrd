import net from 'net';
import querystring from 'querystring';
import { WebSocket, WebSocketServer } from 'ws';
import Listener from '../../listener/index.js';
import { Logger } from '../../logger.js';
import TunnelService from '../../tunnel/tunnel-service.js';
import {
    ERROR_TUNNEL_TRANSPORT_CON_TIMEOUT
} from '../../utils/errors.js';
import WebSocketTransport from './ws-transport.js';
import TransportEndpoint, { EndpointResult, TransportEndpointOptions } from '../transport-endpoint.js';
import HttpListener from '../../listener/http-listener.js';
import Tunnel from '../../tunnel/tunnel.js';
import { URL } from 'url';
import { IncomingMessage } from 'http';

export type WebSocketEndpointOptions = {
    enabled: boolean,
    baseUrl: string,
    port: number,
}

export type _WebSocketEndpointOptions = WebSocketEndpointOptions & TransportEndpointOptions & {
    callback?: (err?: Error | undefined) => void,
}

export interface WebSocketEndpointResult extends EndpointResult {
} 

type WSConnection = {
    wst: WebSocketTransport,
    ws: WebSocket,
}

type RawHttpResponse = {
    status: number,
    statusLine: string,
    body?: string
}

export default class WebSocketEndpoint extends TransportEndpoint {
    static BASE_PATH = '/v1/tunnel';
    static PATH_MATCH = new RegExp(`${WebSocketEndpoint.BASE_PATH}\/([^/]+)/ws-endpoint`);
    static UPGRADE_TIMEOUT = 5000;

    private opts: _WebSocketEndpointOptions;
    private logger: any;
    private httpListener: HttpListener;
    private tunnelService: TunnelService;
    private wss: WebSocketServer;
    private _upgradeHandler: any;
    private connections: Array<WSConnection>; 
    
    constructor(opts: _WebSocketEndpointOptions) {
        super(opts);
        this.opts = opts;
        this.logger = Logger("ws-endpoint");
        this.httpListener = Listener.acquire('http', opts.port);
        this.tunnelService = new TunnelService();
        this.wss = new WebSocketServer({ noServer: true });
        this.connections = [];

        this._upgradeHandler = this.httpListener.use('upgrade', { logger: this.logger }, async (ctx: any, next: any) => {
            if (!await this.handleUpgrade(ctx.req, ctx.sock, ctx.head)) {
                return next();
            }
        });

        this.httpListener.listen()
            .then(() => {
                this.logger.info({
                    message: `WS transport connection endpoint listening on port ${opts.port}`,
                });
                typeof opts.callback === 'function' && opts.callback();
            })
            .catch((err) => {
                this.logger.error({
                    message: `Failed to initialize WS transport connection endpoint: ${err}`,
                })
                typeof opts.callback === 'function' && opts.callback(err);
            });
    }

    public getEndpoint(tunnel: Tunnel, baseUrl: URL): WebSocketEndpointResult {
        const url = new URL(baseUrl.href);
        url.protocol = baseUrl.protocol == 'https:' ? 'wss' : 'ws';
        url.pathname =  `${WebSocketEndpoint.BASE_PATH}/${tunnel.id}/ws-endpoint`;
        url.search = '?' + querystring.encode({t: tunnel.config.transport.token});
        return {
            url: url.href,
        };
    }

    protected async _destroy(): Promise<void> {
        this.httpListener.removeHandler('upgrade', this._upgradeHandler);
        for (const connection of this.connections) {
            const {wst, ws} = connection;
            await wst.destroy();
            ws.close(1001, "Server shutting down");
        }
        this.connections = [];
        this.wss.close();
        await Promise.allSettled([
            this.tunnelService.destroy(),
            Listener.release('http', this.opts.port),
        ]);
    }

    private _getRequestClientIp(req: IncomingMessage): string {
        let ip: string = ""; 
        if (typeof req.headers['x-forwarded-for'] == 'string') {
            ip = req.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
        }
        return net.isIP(<any>ip) ? ip : req.socket.remoteAddress || "";
    }

    private _parseRequest(req: IncomingMessage): {tunnelId: string, token: string | null} | undefined {
        let requestUrl;
        try {
            requestUrl = new URL(<any>req.url, `http://${req.headers.host}`);
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

    private _unauthorized(sock: net.Socket, request: IncomingMessage): RawHttpResponse {
        const response = {
            status: 401,
            statusLine: 'Unauthorized'
        }
        return this._rawHttpResponse(sock, request, response);
    };

    private _rawHttpResponse(sock: net.Socket, request: IncomingMessage, response: RawHttpResponse): RawHttpResponse {
        sock.write(`HTTP/${request.httpVersion} ${response.status} ${response.statusLine}\r\n`);
        sock.write('\r\n');
        response.body && sock.write(response.body);
        sock.destroy();
        return response;
    }

    async handleUpgrade(req: IncomingMessage, sock: net.Socket, head: Buffer) {

        //if (req.upgrade !== true) {
        //    this.logger.trace("upgrade called on non-upgrade request");
        //    return undefined;
        //}

        const parsed = this._parseRequest(req);
        if (parsed == undefined) {
            return undefined;
        }

        const {tunnelId, token} = parsed;
        if (!tunnelId || !token) {
            return this._unauthorized(sock, req);
        }

        const authResult = await this.tunnelService.authorize(tunnelId, token);
        if (authResult.authorized == false || !authResult.tunnel || !authResult.account) {
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

        const timeout = setTimeout(() => {
            this.logger.withContext("tunnel", tunnelId).debug(`HTTP upgrade on websocket timeout`);
            this._rawHttpResponse(sock, req, {
                status: 504,
                statusLine: 'Timeout',
                body: JSON.stringify({error: ERROR_TUNNEL_TRANSPORT_CON_TIMEOUT}),
            });
        }, WebSocketEndpoint.UPGRADE_TIMEOUT);

        this.wss.handleUpgrade(req, sock, head, async (ws) => {
            clearTimeout(timeout);
            const transport = new WebSocketTransport({
                tunnelId: tunnel.id,
                max_connections: this.max_connections,
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
                ws.close(1008, "unable to establish tunnel");
            } else {
                this.connections.push({wst: transport, ws});
            }
        });
        return true;
    }
}