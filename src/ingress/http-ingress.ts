import http, { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'http';
import net from 'net';
import NodeCache from 'node-cache';
import EventBus from '../cluster/eventbus.js';
import Listener from '../listener/listener.js';
import IngressUtils from './utils.js';
import { Logger } from '../logger.js';
import TunnelService from '../tunnel/tunnel-service.js';
import AltNameService from '../tunnel/altname-service.js';
import Node from '../cluster/cluster-node.js';
import { ERROR_TUNNEL_NOT_FOUND,
         ERROR_TUNNEL_NOT_CONNECTED,
         ERROR_TUNNEL_HTTP_INGRESS_DISABLED,
         ERROR_HTTP_INGRESS_REQUEST_LOOP,
         ERROR_TUNNEL_TRANSPORT_REQUEST_LIMIT,
         ERROR_TUNNEL_TARGET_CON_REFUSED,
         ERROR_TUNNEL_TARGET_CON_FAILED,
         ERROR_UNKNOWN_ERROR,
} from '../utils/errors.js';
import {
    HTTP_HEADER_EXPOSR_VIA,
    HTTP_HEADER_X_FORWARDED_HOST,
    HTTP_HEADER_X_FORWARDED_FOR,
    HTTP_HEADER_X_REAL_IP,
    HTTP_HEADER_CONNECTION,
    HTTP_HEADER_X_FORWARDED_PORT,
    HTTP_HEADER_X_FORWARDED_PROTO,
    HTTP_HEADER_FORWARDED
} from '../utils/http-headers.js';
import HttpListener, { HttpRequestCallback, HttpRequestType, HttpUpgradeCallback } from '../listener/http-listener.js';
import Tunnel from '../tunnel/tunnel.js';
import { Duplex } from 'stream';
import IngressBase from './ingress-base.js';
import TunnelConnectionManager, { CreateConnectionContext } from '../tunnel/tunnel-connection-manager.js';

type CreateConnectionCallback = (options: object, callback: (err: Error | undefined, sock: Duplex) => void) => Duplex;

class IngressHttpAgent extends http.Agent {
    private createConnectionCallback: CreateConnectionCallback;
    public activeTunnelConnections: number = 0;

    constructor(opts: http.AgentOptions, createConnectionCallback: CreateConnectionCallback) {
        super(opts);
        this.createConnectionCallback = createConnectionCallback;
    }

    public createConnection(options: object, callback: (err: Error | undefined, sock: Duplex) => void): Duplex {
        return this.createConnectionCallback(options, callback);
    }
}

export type HttpIngressOptions = {
    subdomainUrl: URL;    
    httpAgentTTL?: number;
    port: number;
}

type _HttpIngressOptions = HttpIngressOptions & {
    callback: (error?: Error) => void;
}

export default class HttpIngress implements IngressBase {

    private opts: any;
    private logger: any;
    private _agent_ttl: number;
    private altNameService: any;
    private tunnelService: TunnelService;
    private httpListener: HttpListener;
    private _requestHandler: HttpRequestCallback;
    private _upgradeHandler: HttpUpgradeCallback;
    private _agentCache: NodeCache;
    private eventBus: EventBus;
    
    public destroyed: boolean;

    constructor(opts: _HttpIngressOptions) {
        this.opts = opts;
        this.logger = Logger("http-ingress");

        if (opts.subdomainUrl == undefined) {
            throw new Error("No wildcard domain given for HTTP ingress");
        }

        this._agent_ttl = opts.httpAgentTTL || 65;

        this.destroyed = false;
        this.altNameService = new AltNameService();
        this.tunnelService = new TunnelService();
        this.httpListener = Listener.acquire(HttpListener, opts.port);

        this._requestHandler = async (ctx, next) => {
            if (!await this.handleRequest(ctx.req, ctx.res, ctx.baseUrl)) {
                next();
            }
        };
        this.httpListener.use(HttpRequestType.request, { logger: this.logger, prio: 1 }, this._requestHandler); 

        this._upgradeHandler = async (ctx, next) => {
            if (!await this.handleUpgradeRequest(ctx.req, ctx.sock, ctx.head, ctx.baseUrl)) {
                next();
            }
        };
        this.httpListener.use(HttpRequestType.upgrade, { logger: this.logger }, this._upgradeHandler); 

        this._agentCache = new NodeCache({
            useClones: false,
            deleteOnExpire: false,
            checkperiod: this._agent_ttl,
        });

        this._agentCache.on('expired', (key, agent) => {
            if (agent.activeTunnelConnections > 0) {
                this.logger.withContext("tunnel", key).debug({
                    message: 'extended http agent cache ttl',
                    active_connections: agent.activeTunnelConnections,
                });
                this._agentCache.set(key, agent, this._agent_ttl);
                return;
            }
            this._agentCache.del(key);
            agent.destroy();
            agent.removeAllListeners();
            this.logger.isDebugEnabled() &&
                this.logger.withContext("tunnel", key).debug("http agent destroyed")
        });

        const eventBus = this.eventBus = new EventBus();
        eventBus.on('disconnected', (data) => {
            this._agentCache.ttl(data?.tunnelId, -1);
        });

        this.httpListener.listen()
            .then(() => {
                this.logger.info({
                    message: `HTTP ingress listening on port ${opts.port} (agent idle timeout ${opts.httpAgentTTL})`,
                    url: opts.subdomainUrl,
                });
                typeof opts.callback === 'function' && opts.callback();
            })
            .catch((err) => {
                this.logger.error({
                    message: `Failed to initialize HTTP ingress: ${err.message}`,
                });
                typeof opts.callback === 'function' && opts.callback(err);
            });
    }

    public getBaseUrl(tunnelId: string): URL {
        const url = new URL(this.opts.subdomainUrl.href);
        if (tunnelId) {
            url.hostname = `${tunnelId}.${url.hostname}`;
        }
        return url;
    }

    private async _getTunnel(req: IncomingMessage): Promise<Tunnel | undefined | false> {
        const host = (req.headers.host || '').toLowerCase().split(":")[0];
        if (!host) {
            return undefined;
        }

        let tunnelId = IngressUtils.getTunnelId(host, this.opts.subdomainUrl.hostname);
        if (!tunnelId) {
            tunnelId = await this.altNameService.get('http', host);
            if (!tunnelId) {
                return undefined;
            }
        }
        try {
            const tunnel = await this.tunnelService.lookup(tunnelId);
            return tunnel;
        } catch (e) {
            return false;
        }
    }

    private _clientIp(req: IncomingMessage): string {
        let ip: string = req.socket.remoteAddress || ''; 
        if (req.headers[HTTP_HEADER_X_FORWARDED_FOR]) {
            ip = (req.headers[HTTP_HEADER_X_FORWARDED_FOR] as string).split(/\s*,\s*/)[0];
        }
        return net.isIP(ip) ? ip : ''; 
    }

    private _createAgent(tunnelId: string, req: IncomingMessage): IngressHttpAgent {

        const remoteAddr = this._clientIp(req);
        const createConnection = (opts: object, callback: (err: Error | undefined, sock: Duplex) => void) => {
            const ctx: CreateConnectionContext = {
                remoteAddr,
                ingress: {
                    port: this.httpListener.getPort(),
                },
            };
            return TunnelConnectionManager.createConnection(tunnelId, ctx, callback);
        };

        const agent = new IngressHttpAgent({
            keepAlive: true,
            timeout: this._agent_ttl * 1000,
        }, createConnection);

        this.logger.isDebugEnabled() &&
            this.logger.withContext("tunnel", tunnelId).debug("http agent created")
        return agent;
    }

    private _getAgent(tunnelId: string, req: IncomingMessage): IngressHttpAgent {
        let agent: IngressHttpAgent | undefined;
        try {
            agent = this._agentCache.get<IngressHttpAgent>(tunnelId);
        } catch (e) {}
        if (agent === undefined) {
            agent = this._createAgent(tunnelId, req);
            this._agentCache.set<IngressHttpAgent>(tunnelId, agent, this._agent_ttl);
        } else {
            this._agentCache.ttl(tunnelId, this._agent_ttl);
        }
        return agent;
    }

    private _requestHeaders(req: IncomingMessage, tunnel: Tunnel, baseUrl: URL | undefined, isUpgrade: boolean): IncomingHttpHeaders {
        const headers = { ... req.headers };
        const clientIp = this._clientIp(req);

        headers[HTTP_HEADER_X_FORWARDED_FOR] = clientIp;
        headers[HTTP_HEADER_X_REAL_IP] = headers[HTTP_HEADER_X_FORWARDED_FOR];

        if (headers[HTTP_HEADER_EXPOSR_VIA]) {
            headers[HTTP_HEADER_EXPOSR_VIA] = `${Node.identifier},${headers[HTTP_HEADER_EXPOSR_VIA]}`;
        } else {
            headers[HTTP_HEADER_EXPOSR_VIA] = Node.identifier;
        }

        if (TunnelConnectionManager.isLocalConnected(tunnel.id)) {
            // Delete connection header if tunnel is
            // locally connected and it's not an upgrade request
            if (!isUpgrade) {
                delete headers[HTTP_HEADER_CONNECTION];
            }

            headers[HTTP_HEADER_X_FORWARDED_HOST] = baseUrl?.host;
            if (baseUrl?.port) {
                headers[HTTP_HEADER_X_FORWARDED_PORT] = baseUrl?.port;
            }
            headers[HTTP_HEADER_X_FORWARDED_PROTO] = baseUrl?.protocol.slice(0, -1);
            if (baseUrl) {
                headers[HTTP_HEADER_FORWARDED] = `by=_exposr;for=${clientIp};host=${baseUrl.host};proto=${baseUrl.protocol.slice(0, -1)}`;
            }

            this._rewriteHeaders(headers, tunnel);
        }

        return headers;
    }

    private _rewriteHeaders(headers: IncomingHttpHeaders, tunnel: Tunnel): void {
        const host = headers['host'];

        if (!tunnel.config.target.url) {
            return;
        }

        let target: URL;
        try {
            target = new URL(tunnel.config.target.url);
        } catch {
            return;
        }
        if (!target.protocol.startsWith('http')) {
            return;
        }

        const rewriteHeaders = ['host', 'referer', 'origin'];
        rewriteHeaders.forEach(headerName => {
            let value = headers[headerName];
            if (value == undefined) {
                return;
            }
            if ((value as string).startsWith('http')) {
                try {
                    const url = new URL(value as string);
                    if (url.host == host) {
                        url.protocol = target.protocol;
                        url.host = target.host;
                        url.port = target.port;
                        headers[headerName] = url.href;
                    }
                } catch {
                }
            } else {
                headers[headerName] = target.host;
            }
        });
    }

    private _loopDetected(req: IncomingMessage): boolean {
        const via = ((req.headers[HTTP_HEADER_EXPOSR_VIA] as string) || '').split(',');
        return via.map((v) => v.trim()).includes(Node.identifier);
    }

    private async handleRequest(req: IncomingMessage, res: ServerResponse, baseUrl: URL | undefined) {

        const httpResponse = (status: number, body: object) => {
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = status;
            res.end(JSON.stringify(body));
        };

        const tunnel = await this._getTunnel(req);
        if (tunnel === undefined) {
            return false;
        } else if (tunnel === false) {
            httpResponse(404, {
                error: ERROR_TUNNEL_NOT_FOUND,
            });
            return true;
        }

        if (!tunnel.state.connected) {
            httpResponse(503, {
                error: ERROR_TUNNEL_NOT_CONNECTED,
            });
            return true;
        }

        if (!tunnel.config.ingress?.http?.enabled) {
            httpResponse(403, {
                error: ERROR_TUNNEL_HTTP_INGRESS_DISABLED,
            });
            return true;
        }

        if (this._loopDetected(req)) {
            httpResponse(508, {
                error: ERROR_HTTP_INGRESS_REQUEST_LOOP,
            });
            return true;
        }

        const opt: http.RequestOptions  = {
            path: req.url,
            method: req.method,
        };

        const agent = opt.agent = this._getAgent(tunnel.id, req);
        opt.headers = this._requestHeaders(req, tunnel, baseUrl, false);

        this.logger.isTraceEnabled() &&
            this.logger.trace({
                operation: 'tunnel-request',
                path: opt.path,
                method: opt.method,
                headers: opt.headers,
            });

        const clientReq = http.request(opt, (clientRes) => {
            agent.activeTunnelConnections++;
            res.writeHead(clientRes.statusCode || 500, clientRes.headers);
            clientRes.pipe(res);
        });

        clientReq.once('close', () => {
            agent.activeTunnelConnections = Math.max(agent.activeTunnelConnections - 1, 0);
        });

        clientReq.on('error', (err: any) => {
            let msg;
            if (err.code === 'EMFILE') {
                res.statusCode = 429;
                msg = ERROR_TUNNEL_TRANSPORT_REQUEST_LIMIT;
            } else if (err.code == 'ECONNRESET') {
                res.statusCode = 502;
                msg = ERROR_TUNNEL_TARGET_CON_REFUSED;
            } else {
                res.statusCode = 502;
                msg = ERROR_TUNNEL_TARGET_CON_FAILED;
            }
            res.end(JSON.stringify({error: msg}));
        });

        req.pipe(clientReq);
        return true;
    }

    private async handleUpgradeRequest(req: IncomingMessage, sock: Duplex, head: Buffer, baseUrl: URL | undefined) {
        const _canonicalHttpResponse = (sock: Duplex, request: IncomingMessage, response: any) => {
            sock.write(`HTTP/${request.httpVersion} ${response.status} ${response.statusLine}\r\n`);
            sock.write('\r\n');
            response.body && sock.write(response.body);
            sock.end();
            sock.destroy();
            return response;
        };

        const tunnel = await this._getTunnel(req);
        if (tunnel === undefined) {
            return false;
        } else if (tunnel === false) {
            _canonicalHttpResponse(sock, req, {
                status: 404,
                statusLine: 'Not Found',
                body: JSON.stringify({error: ERROR_TUNNEL_NOT_FOUND}),
            });
            return true;
        }

        if (!tunnel.state.connected) {
            _canonicalHttpResponse(sock, req, {
                status: 502,
                statusLine: 'Bad Gateway',
                body: JSON.stringify({error: ERROR_TUNNEL_NOT_CONNECTED}),
            });
            return true;
        }

        if (this._loopDetected(req)) {
            _canonicalHttpResponse(sock, req, {
                status: 508,
                statusLine: 'Loop Detected',
                body: JSON.stringify({error: ERROR_HTTP_INGRESS_REQUEST_LOOP}),
            });
            return true;
        }

        const ctx: CreateConnectionContext = {
            remoteAddr: this._clientIp(req),
            ingress: {
                port: this.httpListener.getPort(),
            }
        };
        const target = TunnelConnectionManager.createConnection(tunnel.id, ctx, (err) => {
            if (!err) {
                return;
            }
            let statusCode;
            let statusLine;
            let msg;

            if ((err as any).code === 'EMFILE') {
                statusCode = 429;
                statusLine = 'Too Many Requests';
                msg = ERROR_TUNNEL_TRANSPORT_REQUEST_LIMIT;
            } else if ((err as any).code == 'ECONNRESET') {
                statusCode = 502;
                statusLine = 'Bad Gateway';
                msg = ERROR_TUNNEL_TARGET_CON_REFUSED;
            } else {
                statusCode = 502;
                statusLine = 'Bad Gateway';
                msg = ERROR_TUNNEL_TARGET_CON_FAILED;
            }
            _canonicalHttpResponse(sock, req, {
                status: statusCode,
                statusLine,
                body: JSON.stringify({error: msg}),
            });
        });
        if (!target) {
            _canonicalHttpResponse(sock, req, {
                status: 503,
                statusLine: 'Service Unavailable',
                body: JSON.stringify({error: ERROR_UNKNOWN_ERROR}),
            });
            return true;
        }

        const headers = this._requestHeaders(req, tunnel, baseUrl, true);

        const close = () => {
            target.off('error', close);
            target.off('close', close);
            sock.off('error', close);
            sock.off('close', close);
            sock.destroy();
            target.destroy();
        };

        target.on('connect', () => {
            target.on('error', close);
            target.on('close', close);
            sock.on('error', close);
            sock.on('close', close);

            target.pipe(sock);
            sock.pipe(target);

            let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
            Object.keys(headers).forEach(k => {
                raw += `${k}: ${req.headers[k]}\r\n`;
            });
            raw += '\r\n';
            target.write(raw);
        });

        return true;
    }

    async destroy(): Promise<void> {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.httpListener.removeHandler(HttpRequestType.request, this._requestHandler);
        this.httpListener.removeHandler(HttpRequestType.upgrade, this._upgradeHandler);
        await Promise.allSettled([
            this.tunnelService.destroy(),
            this.altNameService.destroy(),
            this.eventBus.destroy(),
            Listener.release(this.opts.port),
        ]);
    }

}