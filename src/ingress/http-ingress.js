import http, { Agent } from 'http';
import net from 'net';
import NodeCache from 'node-cache';
import EventBus from '../eventbus/index.js';
import Listener from '../listener/index.js';
import IngressUtils from './utils.js';
import { Logger } from '../logger.js';
import TunnelService from '../tunnel/tunnel-service.js';
import AltNameService from './altname-service.js';
import { ERROR_TUNNEL_NOT_FOUND,
         ERROR_TUNNEL_NOT_CONNECTED,
         ERROR_TUNNEL_HTTP_INGRESS_DISABLED,
         ERROR_HTTP_INGRESS_REQUEST_LOOP,
         ERROR_TUNNEL_TRANSPORT_REQUEST_LIMIT,
         ERROR_TUNNEL_UPSTREAM_CON_REFUSED,
         ERROR_TUNNEL_UPSTREAM_CON_FAILED,
         ERROR_UNKNOWN_ERROR,
} from '../utils/errors.js';
import Node from '../utils/node.js';
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

const logger = Logger("http-ingress");
class HttpIngress {

    constructor(opts) {
        this.opts = opts;

        if (opts.subdomainUrl == undefined) {
            throw new Error("No wildcard domain given for HTTP ingress");
        }

        this.destroyed = false;
        this.altNameService = new AltNameService();
        this.tunnelService = new TunnelService(opts.callback);
        this.httpListener = new Listener().getListener('http', opts.port);
        this.httpListener.use('request', { logger, prio: 1 }, async (ctx, next) => {
            if (this.destroyed) {
                return next();
            }
            if (!await this.handleRequest(ctx.req, ctx.res, ctx.baseUrl)) {
                next();
            }
        });
        this.httpListener.use('upgrade', { logger }, async (ctx, next) => {
            if (this.destroyed) {
                return next();
            }
            if (!await this.handleUpgradeRequest(ctx.req, ctx.sock, ctx.head, ctx.baseUrl)) {
                next();
            }
        });

        this._agentCache = new NodeCache({
            useClones: false,
            deleteOnExpire: false,
            checkperiod: 60,
        });

        this._agentCache.on('expired', (key, agent) => {
            const pendingRequests = agent.requests?.length || 0;
            const activeSockets = (agent.sockets?.length || 0) - (agent.freeSockets?.length || 0);
            if (pendingRequests > 0 || activeSockets > 0) {
                logger.withContext("tunnel", key).debug({
                    message: 'extended http agent cache ttl',
                    pendingRequests,
                    activeSockets
                });
                this._agentCache.set(key, agent, 65);
                return;
            }
            this._agentCache.del(key);
            agent.destroy();
            logger.isDebugEnabled() &&
                logger.withContext("tunnel", key).debug("http agent destroyed")
        });

        const eventBus = this.eventBus = new EventBus();
        eventBus.on('disconnected', (data) => {
            this._agentCache.ttl(data?.tunnelId, -1);
        });

        this.httpListener.listen()
            .then(() => {
                logger.info({
                    message: `HTTP ingress listening on port ${opts.port}`,
                    url: this.getBaseUrl(),
                });
                typeof opts.callback === 'function' && opts.callback();
            })
            .catch((err) => {
                logger.error({
                    message: `Failed to initialize HTTP ingress: ${err.message}`,
                });
                typeof opts.callback === 'function' && opts.callback(err);
            });
    }

    getBaseUrl(tunnelId = undefined) {
        const url = new URL(this.opts.subdomainUrl.href);
        if (tunnelId) {
            url.hostname = `${tunnelId}.${url.hostname}`;
        }
        return url;
    }

    getIngress(tunnel, altNames = []) {
        const altUrls = altNames.map((an) => {
            const url = this.getBaseUrl();
            url.hostname = an;
            return url.href;
        });

        const url = this.getBaseUrl(tunnel.id).href;
        return {
            url,
            urls: [
                url,
                ...altUrls,
            ]
        };
    }

    async _getTunnel(req) {
        const host = (req.headers.host || '').toLowerCase().split(":")[0];
        if (!host) {
            return undefined;
        }

        let tunnelId = IngressUtils.getTunnelId(host, this.opts.subdomainUrl.hostname);
        if (!tunnelId) {
            tunnelId = await this.altNameService.get('http', host);
            if (!tunnelId) {
                return tunnelId;
            }
        }

        return this.tunnelService.lookup(tunnelId);
    }

    _clientIp(req) {
        let ip;
        if (req.headers[HTTP_HEADER_X_FORWARDED_FOR]) {
            ip = req.headers[HTTP_HEADER_X_FORWARDED_FOR].split(/\s*,\s*/)[0];
        }
        return net.isIP(ip) ? ip : req.socket.remoteAddress;
    }

    _createAgent(tunnelId) {
        const agent = new Agent({
            keepAlive: true,
        });

        agent.createConnection = (opts, callback) => {
            const ctx = {
                ingress: {
                    tls: false,
                    port: this.httpListener.getPort(),
                },
                opts,
            };
            return this.tunnelService.createConnection(tunnelId, ctx, callback);
        };

        logger.isDebugEnabled() &&
            logger.withContext("tunnel", tunnelId).debug("http agent created")
        return agent;
    }

    _getAgent(tunnelId) {
        let agent;
        try {
            agent = this._agentCache.get(tunnelId);
        } catch (e) {}
        if (agent === undefined) {
            agent = this._createAgent(tunnelId);
            this._agentCache.set(tunnelId, agent, 65);
        } else {
            this._agentCache.ttl(tunnelId, 65);
        }
        return agent;
    }

    _requestHeaders(req, tunnel, baseUrl) {
        const headers = { ... req.headers };
        const clientIp = this._clientIp(req);

        headers[HTTP_HEADER_X_FORWARDED_FOR] = clientIp;
        headers[HTTP_HEADER_X_REAL_IP] = headers[HTTP_HEADER_X_FORWARDED_FOR];

        if (headers[HTTP_HEADER_EXPOSR_VIA]) {
            headers[HTTP_HEADER_EXPOSR_VIA] = `${Node.identifier},${headers[HTTP_HEADER_EXPOSR_VIA] }`;
        } else {
            headers[HTTP_HEADER_EXPOSR_VIA] = Node.identifier;
        }

        if (this.tunnelService.isLocalConnected(tunnel.id)) {
            // Delete connection header if tunnel is
            // locally connected and it's not an upgrade request
            if (!req.upgrade) {
                delete headers[HTTP_HEADER_CONNECTION];
            }

            headers[HTTP_HEADER_X_FORWARDED_HOST] = baseUrl.host;
            if (baseUrl.port) {
                headers[HTTP_HEADER_X_FORWARDED_PORT] = baseUrl.port;
            }
            headers[HTTP_HEADER_X_FORWARDED_PROTO] = baseUrl.protocol.slice(0, -1);
            headers[HTTP_HEADER_FORWARDED] = `by=_exposr;for=${clientIp};host=${baseUrl.host};proto=${baseUrl.protocol.slice(0, -1)}`;

            this._rewriteHeaders(headers, tunnel);
        }

        return headers;
    }

    _rewriteHeaders(headers, tunnel) {
        const host = headers['host'];

        let upstream;
        if (tunnel.upstream.url) {
            try {
                upstream = new URL(tunnel.upstream.url);
            } catch {}
        }
        if (upstream === undefined || !upstream.protocol.startsWith('http')) {
            return;
        }

        const rewriteHeaders = ['host', 'referer', 'origin'];
        rewriteHeaders.forEach(headerName => {
            let value = headers[headerName];
            if (value == undefined) {
                return;
            }
            if (value.startsWith('http')) {
                try {
                    const url = new URL(value);
                    if (url.host == host) {
                        url.protocol = upstream.protocol;
                        url.host = upstream.host;
                        url.port = upstream.port;
                        headers[headerName] = url.href;
                    }
                } catch {
                }
            } else {
                headers[headerName] = upstream.host;
            }
        });
    }

    _loopDetected(req) {
        const via = (req.headers[HTTP_HEADER_EXPOSR_VIA] || '').split(',');
        return via.map((v) => v.trim()).includes(Node.identifier);
    }

    async handleRequest(req, res, baseUrl) {

        const httpResponse = (status, body) => {
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

        if (!tunnel.state().connected) {
            httpResponse(502, {
                error: ERROR_TUNNEL_NOT_CONNECTED,
            });
            return true;
        }

        if (!tunnel.ingress?.http?.enabled) {
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

        const opt = {
            path: req.url,
            method: req.method,
            keepAlive: true,
        };

        opt.agent = this._getAgent(tunnel.id);
        opt.headers = this._requestHeaders(req, tunnel, baseUrl);

        logger.trace({
            operation: 'tunnel-request',
            path: opt.path,
            method: opt.method,
            headers: opt.headers,
        });

        const clientReq = http.request(opt, (clientRes) => {
            res.writeHead(clientRes.statusCode, clientRes.headers);
            clientRes.pipe(res);
        });

        clientReq.on('error', (err) => {
            let msg;
            if (err.code === 'EMFILE') {
                res.statusCode = 429;
                msg = ERROR_TUNNEL_TRANSPORT_REQUEST_LIMIT;
            } else if (err.code == 'ECONNRESET') {
                res.statusCode = 503;
                msg = ERROR_TUNNEL_UPSTREAM_CON_REFUSED;
            } else {
                res.statusCode = 503;
                msg = ERROR_TUNNEL_UPSTREAM_CON_FAILED;
            }
            res.end(JSON.stringify({error: msg}));
        });

        req.pipe(clientReq);
        return true;
    }

    async handleUpgradeRequest(req, sock, head, baseUrl) {

        const _canonicalHttpResponse = (sock, request, response) => {
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

        if (!tunnel.state().connected) {
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

        const ctx = {
            ingress: {
                tls: false,
                port: this.httpListener.getPort(),
            }
        };
        const upstream = this.tunnelService.createConnection(tunnel.id, ctx);
        if (upstream === undefined) {
            _canonicalHttpResponse(sock, req, {
                status: 503,
                statusLine: 'Service Unavailable',
                body: JSON.stringify({error: ERROR_UNKNOWN_ERROR}),
            });
            return true;
        }

        const headers = this._requestHeaders(req, tunnel, baseUrl);
        upstream.on('error', (err) => {
            sock.end();
        });

        upstream.on('connect', () => {
            upstream.pipe(sock);
            sock.pipe(upstream);

            let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
            Object.keys(headers).forEach(k => {
                raw += `${k}: ${req.headers[k]}\r\n`;
            });
            raw += '\r\n';
            upstream.write(raw);
        });

        return true;
    }

    async destroy() {
        this.destroyed = true;
        return Promise.allSettled([
            this.eventBus.destroy(),
            this.tunnelService.destroy(),
            this.httpListener.destroy(),
        ]);
    }

}

export default HttpIngress;