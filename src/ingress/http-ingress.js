import http, { Agent } from 'http';
import net from 'net';
import EventBus from '../eventbus/index.js';
import Listener from '../listener/index.js';
import { Logger } from '../logger.js';
import TunnelService from '../tunnel/tunnel-service.js';
import Node from '../utils/node.js';
import NodeCache from 'node-cache';

const logger = Logger("http-ingress");
class HttpIngress {

    static HTTP_HEADER_EXPOSR_VIA = 'exposr-via';

    constructor(opts) {
        this.opts = opts;

        if (opts.subdomainUrl == undefined) {
            throw new Error("No wildcard domain given for HTTP ingress");
        }

        this.destroyed = false;
        this.tunnelService = new TunnelService(opts.callback);
        this.httpListener = new Listener().getListener('http');
        this.httpListener.use('request', async (ctx, next) => {
            if (this.destroyed) {
                return next();
            }
            if (!await this.handleRequest(ctx.req, ctx.res)) {
                next();
            }
        });
        this.httpListener.use('upgrade', async (ctx, next) => {
            if (this.destroyed) {
                return next();
            }
            if (!await this.handleUpgradeRequest(ctx.req, ctx.sock, ctx.head)) {
                next();
            }
        });

        this._agentCache = new NodeCache({
            useClones: false,
            deleteOnExpire: false,
        });
        this._agentCache.on('del', (key, agent) => {
            agent.destroy();
            logger.isDebugEnabled() &&
                logger.withContext("tunnel", key).debug("http agent destroyed")
        });

        const eventBus = this.eventBus = new EventBus();
        eventBus.on('disconnected', (data) => {
            this._agentCache.ttl(data?.tunnelId, 0);
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

        return this.tunnelService.lookup(tunnelId);
    }

    _clientIp(req) {
        let ip;
        if (req.headers['x-forwarded-for']) {
            ip = req.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
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
        let agent = this._agentCache.get(tunnelId);
        if (agent === undefined) {
            agent = this._createAgent(tunnelId);
            this._agentCache.set(tunnelId, agent, 65);
        } else {
            this._agentCache.ttl(tunnelId, 65);
        }
        return agent;
    }

    _requestHeaders(req, tunnel) {
        const headers = { ... req.headers };
        delete headers['connection'];
        headers['x-forwarded-for'] = this._clientIp(req);
        headers['x-real-ip'] = headers['x-forwarded-for'];

        if (headers[HttpIngress.HTTP_HEADER_EXPOSR_VIA]) {
            headers[HttpIngress.HTTP_HEADER_EXPOSR_VIA] = `${Node.identifier},${headers[HttpIngress.HTTP_HEADER_EXPOSR_VIA] }`;
        } else {
            headers[HttpIngress.HTTP_HEADER_EXPOSR_VIA] = Node.identifier;
        }

        if (this.tunnelService.isLocalConnected(tunnel.id)) {
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

        const rewriteHeaders = ['host', 'referer', 'origin'];
        if (upstream !== undefined && upstream.protocol.startsWith('http')) {
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
    }

    async handleRequest(req, res) {
        const tunnel = await this._getTunnel(req);
        if (tunnel === undefined) {
            return false;
        } else if (tunnel === false) {
            res.statusCode = 404;
            res.end(JSON.stringify({
                error: 'not configured'
            }));
            return true;
        }

        if (!tunnel.state().connected) {
            res.statusCode = 502;
            res.end(JSON.stringify({
                error: 'not connected'
            }));
            return true;
        }

        if (!tunnel.ingress?.http?.enabled) {
            res.statusCode = 403;
            res.end(JSON.stringify({
                error: 'http ingress not enabled'
            }));
            return true;
        }

        const opt = {
            path: req.url,
            method: req.method,
            keepAlive: true,
        };

        opt.agent = this._getAgent(tunnel.id);
        opt.headers = this._requestHeaders(req, tunnel);

        const logRequest = (fields) => {
            logger.isTraceEnabled() &&
                logger
                    .withContext('tunnel', tunnel.id)
                    .trace({
                        request: {
                            method: req.method,
                            path: req.path,
                            headers: req.headers,
                        },
                        ...fields,
                    });
        };

        const clientReq = http.request(opt, (clientRes) => {
            clientRes.on('error', (err) => {
                logger.error({
                    msg: 'socket error',
                    err,
                });
            });
            logRequest({
                response: {
                    status: clientRes.statusCode,
                    headers: clientRes.headers,
                },
                socket: clientRes.socket.toString(),
            })
            res.writeHead(clientRes.statusCode, clientRes.headers);
            clientRes.pipe(res);
        });

        clientReq.on('error', (err) => {
            let msg;
            if (err.code === 'EMFILE') {
                res.statusCode = 429;
                msg = 'concurrent request limit';
            } else if (err.code == 'ECONNRESET') {
                res.statusCode = 503;
                msg = 'upstream connection refused';
            } else {
                res.statusCode = 503;
                msg = 'upstream request failed';
            }
            logRequest({
                response: {
                    status: res.statusCode,
                },
                err,
            })
            res.end(JSON.stringify({error: msg}));
        });

        req.pipe(clientReq);
        return true
    }

    async handleUpgradeRequest(req, sock, head) {

        const _rawHttpResponse = (sock, request, response) => {
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
            _rawHttpResponse(sock, req, {
                status: 404,
                statusLine: 'Not Found',
                body: JSON.stringify({error: 'not configured'}),
            });
            return true;
        }

        if (!tunnel.state().connected) {
            _rawHttpResponse(sock, req, {
                status: 502,
                statusLine: 'Bad Gateway',
                body: JSON.stringify({error: 'not connected'}),
            });
            return true;
        }

        const headers = this._requestHeaders(req, tunnel);

        const logRequest = (fields) => {
            const onNode = this.tunnelService.isLocalConnected(tunnelId);
            logger.isTraceEnabled() &&
                logger
                    .withContext('tunnel', tunnel.id)
                    .trace({
                        request: {
                            method: req.method,
                            path: req.path,
                            headers: headers,
                        },
                        redirect: !onNode,
                        ...fields,
                    });
        };

        const ctx = {
            ingress: {
                tls: false,
                port: this.httpListener.getPort(),
            }
        };
        const upstream = this.tunnelService.createConnection(tunnel.id, ctx);
        if (upstream === undefined) {
            sock.end();
            return true;
        }

        upstream.on('error', (err) => {
            logRequest(err)
            sock.end();
        });

        upstream.on('connect', () => {
            logRequest();
            upstream.pipe(sock);
            sock.pipe(upstream);

            let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
            Object.keys(headers).forEach(k => {
                raw += `${k}: ${req.headers[k]}\r\n`;
            });
            raw += '\r\n';
            upstream.write(raw);
        });

        return true
    }

    async destroy() {
        await this.tunnelService.destroy();
        this.destroyed = true;
    }

}

export default HttpIngress;