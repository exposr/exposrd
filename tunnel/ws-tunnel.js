import http from 'http';
import querystring from 'querystring';
import TunnelInterface from './tunnel-interface.js';
import WebSocketMultiplex from './ws-multiplex.js';
import WebSocketAgent from './ws-agent.js';

class WebSocketTunnel extends TunnelInterface {
    constructor(tunnel, baseUrl) {
        const url = new URL(baseUrl.href);
        url.protocol = baseUrl.protocol == 'https:' ? 'wss' : 'ws';
        url.hostname = `${tunnel.id}.${url.hostname}`;
        url.search = '?' + querystring.encode({token: tunnel.authToken});
        super(tunnel, url.href);
        this.connected = false;
    }

    async _connect(sock, req, res, head) {
        if (this.connected) {
            return true;
        }

        const self = this;
        return new Promise((resolve, reject) => {
            if (req.upgrade !== true) {
                return reject("upgrade request expected");
            }

            const timeout = setTimeout(() => {
                self.connected = false;
                reject("timeout");
            }, 1000);
            self.connected = true;
            sock.handleUpgrade(req, res, head, (ws) => {
                clearTimeout(timeout);
                const multiplex = self.multiplex = new WebSocketMultiplex(ws);
                self.agent = new WebSocketAgent(multiplex);

                ws.once('close', () => {
                    multiplex.terminate();
                    ws.terminate();
                    self.connected = false;
                    self.multiplex = undefined;
                });
                resolve(false);
            });
        });
    }

    async httpRequest(sock, req, res, head) {
        const shouldContinue = await this._connect(sock, req, res, head)
            .catch(err => {
                res.statusCode = 503;
                res.end(JSON.stringify({error: "tunnel not connected"}));
                return false;
            });

        if (!shouldContinue) {
            return;
        }

        const opt = {
            path: req.url,
            agent: this.agent,
            method: req.method,
            headers: req.headers,
            keepAlive: true,
        };

        const clientReq = http.request(opt, (clientRes) => {
            res.writeHead(clientRes.statusCode, clientRes.headers);
            clientRes.pipe(res);
        });

        clientReq.on('error', (err) => {
            res.statusCode = 502;
            res.end(JSON.stringify({error: "tunnel request failed"}));
        });

        req.pipe(clientReq);
    }
}

export default WebSocketTunnel;