import net from 'net';
import http, { Agent } from 'http';
import Listener from '../listener/index.js';
import TunnelManager from '../tunnel/tunnel-manager.js';
import { Logger } from '../logger.js';

const logger = Logger("http-ingress");
class HttpIngress {
    constructor(opts) {
        this.opts = opts;

        if (opts.subdomainUrl == undefined) {
            throw new Error("No wildcard domain given for HTTP ingress");
        }

        this.tunnelManager = new TunnelManager();
        this.httpListener = new Listener().getListener('http');
        this.httpListener.use('request', async (ctx, next) => {
            if (!await this.handleRequest(ctx.req, ctx.res)) {
                next();
            }
        });
        this.httpListener.use('upgrade', async (ctx, next) => {
            if (!await this.handleUpgradeRequest(ctx.req, ctx.sock, ctx.head)) {
                next();
            }
        });

        this._agents = {};
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
        if (req.headers['x-forwarded-for']) {
            ip = req.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
        }
        return net.isIP(ip) ? ip : req.socket.remoteAddress;
    }

    _getAgent(tunnel) {
        const createAgent = () => {
            const agent = new Agent({
                keepAlive: true,
            });

            agent.createConnection = (opts, callback) => {
                if (tunnel.connected) {
                    const sock = tunnel.transport.createConnection(opts, callback);
                    return sock;
                } else {
                    return undefined;
                }
            };

            return agent;
        };

        const deleteAgent = () => {
            const tunnelAgent = this._agents[tunnel.id];
            if (tunnelAgent === undefined) {
                return;
            }
            tunnelAgent.agent.destroy();
            clearTimeout(tunnelAgent.timer);
            if (tunnel.transport !== undefined) {
                tunnel.transport.removeListener('close', deleteAgent);
            }
            delete this._agents[tunnel.id];
            logger.isDebugEnabled() &&
                logger.withContext("tunnel", tunnel.id).debug("http agent destroyed")
        };

        let agent;
        if (this._agents[tunnel.id] !== undefined) {
            agent = this._agents[tunnel.id].agent;
            clearTimeout(this._agents[tunnel.id].timer);
        } else {
            agent = createAgent();
            tunnel.transport.once('close', deleteAgent);
            logger.isDebugEnabled() &&
                logger.withContext("tunnel", tunnel.id).debug("http agent created")
        }

        this._agents[tunnel.id] = {
            agent: agent,
            timer: setTimeout(deleteAgent, 65000)
        }
        return agent;

    }

    _requestHeaders(req, tunnel) {
        const headers = { ... req.headers };
        const host = headers['host'];
        delete headers['connection'];
        headers['x-forwarded-for'] = this._clientIp(req);
        headers['x-real-ip'] = headers['x-forwarded-for'];

        let upstream;
        if (tunnel.spec.upstream.url) {
            try {
                upstream = new URL(tunnel.spec.upstream.url);
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

        return headers;
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

        if (!tunnel.connected) {
            res.statusCode = 502;
            res.end(JSON.stringify({
                error: 'not connected'
            }));
            return true;
        }

        if (!tunnel.spec.ingress?.http?.enabled) {
            res.statusCode = 403;
            res.end(JSON.stringify({
                error: 'http ingress not enabled'
            }));
            return true;
        }

        const opt = {
            path: req.url,
            agent: this._getAgent(tunnel),
            method: req.method,
            headers: this._requestHeaders(req, tunnel),
            family: 4,
            localAddress: "localhost",
            lookup: () => {
                return "127.0.0.1";
            },
            keepAlive: true,
        };

        logger.isTraceEnabled() &&
            logger.withContext('tunnel', tunnel.id).trace({
                method: opt.method,
                path: opt.path,
                headers: opt.headers,
            });

        const clientReq = http.request(opt, (clientRes) => {
            res.writeHead(clientRes.statusCode, clientRes.headers);
            clientRes.pipe(res);
        });

        clientReq.on('error', (err) => {
            logger.isDebugEnabled() &&
                logger.withContext("tunnel", tunnel.id).debug(`HTTP request failed: ${err.message} (${err.code})`);
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

        if (!tunnel.connected) {
            _rawHttpResponse(sock, req, {
                status: 502,
                statusLine: 'Bad Gateway',
                body: JSON.stringify({error: 'not connected'}),
            });
            return true;
        }

        logger.isTraceEnabled() &&
            logger.withContext('tunnel', tunnel.id).trace({
                method: req.method,
                path: req.url,
                headers: req.headers,
            });

        const upstream = tunnel.transport.createConnection();
        if (upstream === undefined) {
            sock.end();
            return true;
        }

        upstream.on('error', (err) => {
            logger.withContext("tunnel", tunnel.id).debug(err);
            sock.end();
        });

        const headers = this._requestHeaders(req, tunnel);
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

        return true
    }

}

export default HttpIngress;