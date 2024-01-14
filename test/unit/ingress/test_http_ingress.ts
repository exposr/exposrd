import assert from 'assert/strict';
import crypto from 'crypto';
import dns from 'dns/promises';
import AccountService from "../../../src/account/account-service.js";
import Config from "../../../src/config.js";
import IngressManager, { IngressType } from "../../../src/ingress/ingress-manager.js";
import TunnelService from "../../../src/tunnel/tunnel-service.js";
import { createEchoHttpServer, wsSocketPair, wsmPair } from "../test-utils.js";
import sinon from 'sinon';
import net from 'net'
import http from 'http';
import Tunnel from '../../../src/tunnel/tunnel.js';
import Account from '../../../src/account/account.js';
import { WebSocketMultiplex } from '@exposr/ws-multiplex';
import WebSocketTransport from '../../../src/transport/ws/ws-transport.js';
import { Duplex } from 'stream';
import CustomError, { ERROR_TUNNEL_INGRESS_BAD_ALT_NAMES } from '../../../src/utils/errors.js';
import HttpIngress from '../../../src/ingress/http-ingress.js';
import { httpRequest } from './utils.js';
import TunnelConnectionManager from '../../../src/tunnel/tunnel-connection-manager.js';
import ClusterManager, { ClusterManagerType } from '../../../src/cluster/cluster-manager.js';
import StorageManager from '../../../src/storage/storage-manager.js';

describe('http ingress', () => {
    let clock: sinon.SinonFakeTimers;
    let config: Config;

    before(async () => {
        config = new Config();
        await ClusterManager.init(ClusterManagerType.MEM);
        await StorageManager.init(new URL("memory://"));

        clock = sinon.useFakeTimers({shouldAdvanceTime: true});
        await TunnelConnectionManager.start();
        await IngressManager.listen({
            http: {
                enabled: true,
                port: 10000,
                httpAgentTTL: 5,
                subdomainUrl: new URL("http://localhost.example")
            },
        });
        echoServer = await createEchoHttpServer(20000);
    });

    after(async () => {
        await TunnelConnectionManager.stop();
        await IngressManager.close();
        await StorageManager.close();
        await ClusterManager.close();
        await config.destroy();
        await echoServer.destroy();
        clock.restore();
    });

    let accountService: AccountService;
    let tunnelService: TunnelService;
    let account: Account | undefined;
    let tunnel: Tunnel | undefined;
    let sockPair: wsSocketPair;
    let client: WebSocketMultiplex;
    let transport: WebSocketTransport;
    let echoServer: { destroy: () => Promise<void>; };

    beforeEach(async () => {
        tunnelService = new TunnelService();
        accountService = new AccountService();

        account = await accountService.create();
        assert(account != undefined);
        const tunnelId = crypto.randomBytes(20).toString('hex');
        tunnel = await tunnelService.create(tunnelId, <string>account.id);
        tunnel = await tunnelService.update(tunnelId, <string>account.id, (tunnel) => {
            tunnel.ingress.http.enabled = true;
        });

        sockPair = await wsSocketPair.create(9000)
        assert(sockPair != undefined);
        ({client, transport} = wsmPair(sockPair));
    });

    afterEach(async () => {
        await client.destroy();
        await transport.destroy();
        await sockPair.terminate();
        await tunnelService.destroy();
        await accountService.destroy();
        account = undefined;
        tunnel = undefined;
    });

    const forwardTo = (host: string, port: number): void => {
        client.on('connection', (sock: Duplex) => {
            const targetSock = new net.Socket();
            targetSock.connect({
                host,
                port
            }, () => {
                targetSock.pipe(sock);
                sock.pipe(targetSock);
            });

            const close = () => {
                targetSock.unpipe(sock);
                sock.unpipe(targetSock);
                sock.destroy();
                targetSock.destroy();
            };

            targetSock.on('close', close);
            sock.on('close', close);
            sock.on('error', () => {
                close();
            });
            targetSock.on('error', () => {
                close();
            });
        });
    };

    const connectTunnel = async (): Promise<void> => {
        assert(tunnel != undefined);
        assert(account != undefined);
        assert(tunnel.id != undefined);
        assert(account.id != undefined);

        let res = await tunnelService.connect(tunnel.id, account.id, transport, {peer: "127.0.0.1"});
        assert(res == true, "failed to connect tunnel");

        let i = 0;
        let tun: Tunnel;
        do {
            await clock.tickAsync(1000);
            tun = await tunnelService.lookup(tunnel.id)
        } while (tun.state.connected == false && i++ < 10);
        assert(tun.state.connected == true, "tunnel not connected");
    }

    it('can send traffic', async () => {
        assert(tunnel != undefined);
        assert(account != undefined);
        assert(tunnel.id != undefined);
        assert(account.id != undefined);

        client.on('connection', (sock: Duplex) => {
            const targetSock = new net.Socket();
            targetSock.connect({
                host: 'localhost',
                port: 10000
            }, () => {
                targetSock.pipe(sock);
                sock.pipe(targetSock);
            });

            const close = () => {
                targetSock.unpipe(sock);
                sock.unpipe(targetSock);
                sock.destroy();
                targetSock.destroy();
            };

            targetSock.on('close', close);
            sock.on('close', close);
            sock.on('error', () => {
                close();
            });
            targetSock.on('error', () => {
                close();
            });
        });

        let res = await tunnelService.connect(tunnel.id, account.id, transport, {peer: "127.0.0.1"});
        assert(res == true, "failed to connect tunnel");

        let i = 0;
        let tun: Tunnel;
        do {
            await clock.tickAsync(1000);
            tun = await tunnelService.lookup(tunnel.id)
        } while (tun.state.connected == false && i++ < 10);
        assert(tun.state.connected == true, "tunnel not connected");

        let {status, data}: {status: number | undefined, data: any} = await new Promise((resolve) => {
            const req = http.request({
                hostname: 'localhost',
                port: 20000,
                method: 'GET',
                path: '/file?size=1048576',
                headers: {
                    "Host": `${tunnel?.id}.localhost.example`
                }
            }, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('close', () => { resolve({status: res.statusCode, data})});
            });
            req.end();
        });

        await tunnelService.disconnect(tunnel.id, account.id);

        assert(status == 200, `expected 200 status, got ${status}`);
        assert(data.length == 1048576, `did not receive expected data, got data length ${data.length}`);
    });

    it('agent does not timeout during transfer', async () => {
        assert(tunnel != undefined);
        assert(account != undefined);
        assert(tunnel.id != undefined);
        assert(account.id != undefined);

        let res = await tunnelService.connect(tunnel.id, account.id, transport, {peer: "127.0.0.1"});
        assert(res == true, "failed to connect tunnel");

        let i = 0;
        let tun: Tunnel;
        do {
            await clock.tickAsync(1000);
            tun = await tunnelService.lookup(tunnel.id)
        } while (tun.state.connected == false && i++ < 10);
        assert(tun.state.connected == true, "tunnel not connected")

        client.on('connection', (sock) => {
            sock.on('data', async (chunk: any) => {
                //console.log(chunk.toString());
                sock.write("HTTP/1.1 200\r\nContent-Length: 2\r\n\r\n");
                sock.write("A");
                await clock.tickAsync(12500);
                sock.write("A");
                sock.end();
            });
        });

        let {status, data}: {status: number, data: string} = await new Promise((resolve: (res: {status: number, data: string}) => void) => {
            const req = http.request({
                hostname: 'localhost',
                port: 10000,
                method: 'GET',
                path: '/',
                headers: {
                    "Host": `${tunnel?.id}.localhost.example`
                }
            }, (res) => {
                let data: string = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('close', () => { resolve({status: <number>res.statusCode, data})});
            });
            req.end();
        });

        assert(status == 200, `expected status code 200, got ${status}`);
        assert(data == "AA", `did not get expected reply, got ${data}`);

        await tunnelService.disconnect(tunnel.id, account.id);
    });

    it('agent timeout on idle', async () => {
        assert(tunnel != undefined);
        assert(account != undefined);
        assert(tunnel.id != undefined);
        assert(account.id != undefined);

        forwardTo("localhost", 20000);
        await connectTunnel();

        const {status, data} = await httpRequest({
            hostname: 'localhost',
            port: 10000,
            method: 'GET',
            path: '/',
            headers: {
                "Host": `${tunnel.id}.localhost.example`,
            }
        });

        const instance: HttpIngress = IngressManager.getIngress(IngressType.INGRESS_HTTP) as HttpIngress;
        let agent = instance["_agentCache"].get(tunnel.id);
        assert(agent != undefined);

        await clock.tickAsync(10000);

        let agent2 = instance["_agentCache"].get(tunnel.id);
        assert(agent2 == undefined);

        await tunnelService.disconnect(tunnel.id, account.id);
    });

    it(`http ingress can handle websocket upgrades`, async () => {
        assert(tunnel != undefined);
        assert(account != undefined);
        assert(tunnel.id != undefined);
        assert(account.id != undefined);

        client.on('connection', (sock: Duplex) => {
            const targetSock = new net.Socket();
            targetSock.connect({
                host: 'localhost',
                port: 20000
            }, () => {
                targetSock.pipe(sock);
                sock.pipe(targetSock);
            });

            const close = () => {
                targetSock.unpipe(sock);
                sock.unpipe(targetSock);
                sock.destroy();
                targetSock.destroy();
            };

            targetSock.on('close', close);
            sock.on('close', close);
            sock.on('error', () => {
                close();
            });
            targetSock.on('error', () => {
                close();
            });
        });

        let res = await tunnelService.connect(tunnel.id, account.id, transport, {peer: "127.0.0.1"});
        assert(res == true, "failed to connect tunnel");

        let i = 0;
        let tun: Tunnel;
        do {
            await clock.tickAsync(1000);
            tun = await tunnelService.lookup(tunnel?.id)
        } while (tun.state.connected == false && i++ < 10);
        assert(tun.state.connected == true, "tunnel not connected")

        const req = http.request({
            hostname: 'localhost',
            port: 10000,
            method: 'GET',
            path: '/ws',
            headers: {
                "Host": `${tunnel.id}.localhost.example`,
                "Connection": 'Upgrade',
                "Upgrade": 'websocket',
                "Origin": `http://${tunnel.id}.localhost.example`,
                "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
                "Sec-WebSocket-Version": "13"
            }
        });

        const wsWait = new Promise((resolve: (value: any) => void) => {
            req.on('upgrade', (res, socket, head) => {
                const body = head.subarray(2);
                resolve(body);
            });
            req.end();
        });

        const wsRes = await wsWait;

        assert(wsRes.equals(Buffer.from("ws echo connected")), `did not get ws echo, got ${wsRes}`);
    });

    it('handles ingress altname', async () => {
        assert(tunnel != undefined);
        assert(account != undefined);
        assert(tunnel.id != undefined);
        assert(account.id != undefined);

        sinon.stub(dns, 'resolveCname')
            .withArgs('custom-name.example')
            .resolves([`${tunnel.id}.localhost.example`]);

        tunnel = await tunnelService.update(tunnel.id, account?.id, (tunnel) => {
            tunnel.ingress.http.alt_names = [
                "custom-name.example"
            ]
        });

        assert(tunnel instanceof Tunnel);
        assert(tunnel.id != undefined);

        forwardTo("localhost", 20000);
        await connectTunnel();

        const {status, data} = await httpRequest({
            hostname: 'localhost',
            port: 10000,
            method: 'POST',
            path: '/',
            headers: {
                "Host": `custom-name.example`
            }
        }, "echo");

        sinon.restore();
        await tunnelService.disconnect(tunnel.id, account.id);

        assert(status == 200, `expected status code 200, got ${status}`);
        assert(data == "echo", `did not get expected reply, got ${data}`);
    });

    it('adding altname without cname throws error', async () => {
        assert(tunnel != undefined);
        assert(account != undefined);
        assert(tunnel.id != undefined);
        assert(account.id != undefined);

        let error: CustomError | undefined;
        try {
            tunnel = await tunnelService.update(tunnel.id, account.id, (tunnel) => {
                tunnel.ingress.http.alt_names = [
                    "custom-name.example"
                ]
            });
        } catch (e: any) {
            error = e;
        }

        assert(error != undefined, "error not thrown");
        assert(error.code == ERROR_TUNNEL_INGRESS_BAD_ALT_NAMES);
    });

    it('adding altname with wrong cname throws error', async () => {
        assert(tunnel != undefined);
        assert(account != undefined);
        assert(tunnel.id != undefined);
        assert(account.id != undefined);

        sinon.stub(dns, 'resolveCname')
            .withArgs('custom-name.example')
            .resolves([`localhost.example`]);

        let error: CustomError | undefined;
        try {
            tunnel = await tunnelService.update(tunnel.id, account.id, (tunnel) => {
                tunnel.ingress.http.alt_names = [
                    "custom-name.example"
                ]
            });
        } catch (e: any) {
            error = e;
        }

        sinon.restore();

        assert(error != undefined, "error not thrown");
        assert(error.code == ERROR_TUNNEL_INGRESS_BAD_ALT_NAMES);
    });

    it('request headers are rewritten with the target host for http', async () => {
        assert(tunnel != undefined);
        assert(account != undefined);
        assert(tunnel.id != undefined);
        assert(account.id != undefined);

        tunnel = await tunnelService.update(tunnel.id, account?.id, (config) => {
            config.target.url = "https://echo.localhost.example"
        });
        assert(tunnel instanceof Tunnel);
        assert(tunnel.id != undefined);

        forwardTo("localhost", 20000);
        await connectTunnel();

        const {status, data} = await httpRequest({
            hostname: 'localhost',
            port: 10000,
            method: 'GET',
            path: '/headers',
            headers: {
                "Host": `${tunnel.id}.localhost.example`,
                "Origin": `${tunnel.id}.localhost.example`,
                "Referer": `https://${tunnel.id}.localhost.example/page`,
                "X-Forwarded-For": "192.168.0.1",
                "X-Forwarded-proto": "https"
            }
        });

        sinon.restore();
        await tunnelService.disconnect(tunnel.id, account.id);

        const headers = JSON.parse(data);
        assert(headers.host == "echo.localhost.example", `expected host echo.localhost.example, got ${headers.host}`);
        assert(headers.origin == "echo.localhost.example", `expected origin echo.localhost.example, got ${headers.origin}`);
        assert(headers.referer == "https://echo.localhost.example/page", `expected referer https://echo.localhost.example/page, got ${headers.referer}`);
    });

    it('request headers are not rewritten with the target host for non-http', async () => {
        assert(tunnel != undefined);
        assert(account != undefined);
        assert(tunnel.id != undefined);
        assert(account.id != undefined);

        tunnel = await tunnelService.update(tunnel.id, account?.id, (config) => {
            config.target.url = "tcps://echo.localhost.example"
        });
        assert(tunnel instanceof Tunnel);
        assert(tunnel.id != undefined);

        forwardTo("localhost", 20000);
        await connectTunnel();

        const {status, data} = await httpRequest({
            hostname: 'localhost',
            port: 10000,
            method: 'GET',
            path: '/headers',
            headers: {
                "Host": `${tunnel.id}.localhost.example`,
                "Origin": `${tunnel.id}.localhost.example`,
                "Referer": `https://${tunnel.id}.localhost.example/page`,
                "X-Forwarded-For": "192.168.0.1",
                "X-Forwarded-proto": "https"
            }
        });

        sinon.restore();
        await tunnelService.disconnect(tunnel.id, account.id);

        const headers = JSON.parse(data);
        assert(headers.host == `${tunnel.id}.localhost.example`, `expected host ${tunnel.id}.localhost.example, got ${headers.host}`);
        assert(headers.origin == `${tunnel.id}.localhost.example`, `expected origin ${tunnel.id}.localhost.example, got ${headers.origin}`);
        assert(headers.referer == `https://${tunnel.id}.localhost.example/page`, `expected referer https://${tunnel.id}.localhost.example/page, got ${headers.referer}`);
    });

    it('forwarded headers are added to request', async () => {
        assert(tunnel != undefined);
        assert(account != undefined);
        assert(tunnel.id != undefined);
        assert(account.id != undefined);

        forwardTo("localhost", 20000);
        await connectTunnel();

        sinon.stub(net.Socket.prototype, <any>'_getpeername').returns({
            address: "127.0.0.2"
        });

        const {status, data} = await httpRequest({
            hostname: 'localhost',
            port: 10000,
            method: 'GET',
            path: '/headers',
            headers: {
                "Host": `${tunnel.id}.localhost.example`,
            }
        });

        sinon.restore();
        await tunnelService.disconnect(tunnel.id, account.id);

        const headers = JSON.parse(data);
        assert(headers['x-forwarded-for'] == "127.0.0.2", `unexpected x-forwarded-for, got ${headers['x-forwarded-for']}`);
        assert(headers['x-real-ip'] == "127.0.0.2", `unexpected x-real-ip, got ${headers['x-real-ip']}`);
        assert(headers['x-forwarded-proto'] == "http", `unexpected x-forwarded-proto, got ${headers['x-forwarded-proto']}`);
        const forwarded = `by=_exposr;for=127.0.0.2;host=${tunnel.id}.localhost.example;proto=http`
        assert(headers['forwarded'] == forwarded, `unexpected forwarded, got ${headers['forwarded']}`);
        assert(headers['x-forwarded-host'] == `${tunnel.id}.localhost.example`, `${headers['x-forwarded-host']}`);
    });

    it('x-forwarded headers from request are read', async () => {
        assert(tunnel != undefined);
        assert(account != undefined);
        assert(tunnel.id != undefined);
        assert(account.id != undefined);

        forwardTo("localhost", 20000);
        await connectTunnel();

        sinon.stub(net.Socket.prototype, <any>'_getpeername').returns({
            address: "127.0.0.2"
        });

        const {status, data} = await httpRequest({
            hostname: 'localhost',
            port: 10000,
            method: 'GET',
            path: '/headers',
            headers: {
                "Host": `${tunnel.id}.localhost.example`,
                "x-forwarded-for": "127.0.0.3",
                "x-forwarded-proto": "https",
            }
        });

        sinon.restore();
        await tunnelService.disconnect(tunnel.id, account.id);

        const headers = JSON.parse(data);
        assert(headers['x-forwarded-for'] == "127.0.0.3", `unexpected x-forwarded-for, got ${headers['x-forwarded-for']}`);
        assert(headers['x-real-ip'] == "127.0.0.3", `unexpected x-real-ip, got ${headers['x-real-ip']}`);
        assert(headers['x-forwarded-proto'] == "https", `unexpected x-forwarded-proto, got ${headers['x-forwarded-proto']}`);
        const forwarded = `by=_exposr;for=127.0.0.3;host=${tunnel.id}.localhost.example;proto=https`
        assert(headers['forwarded'] == forwarded, `unexpected forwarded, got ${headers['forwarded']}`);
    });

    it('exposr via header is added to request', async () => {
        assert(tunnel != undefined);
        assert(account != undefined);
        assert(tunnel.id != undefined);
        assert(account.id != undefined);

        forwardTo("localhost", 20000);
        await connectTunnel();

        const {status, data} = await httpRequest({
            hostname: 'localhost',
            port: 10000,
            method: 'GET',
            path: '/headers',
            headers: {
                "Host": `${tunnel.id}.localhost.example`,
            }
        });

        await tunnelService.disconnect(tunnel.id, account.id);

        const headers = JSON.parse(data);
        assert(headers['exposr-via']?.length > 0, `via header not set`);
    });

    it('request loops returns 508', async () => {
        assert(tunnel != undefined);
        assert(account != undefined);
        assert(tunnel.id != undefined);
        assert(account.id != undefined);

        forwardTo("localhost", 10000);
        await connectTunnel();

        const {status, data} = await httpRequest({
            hostname: 'localhost',
            port: 10000,
            method: 'GET',
            path: '/headers',
            headers: {
                "Host": `${tunnel.id}.localhost.example`,
            }
        });

        await tunnelService.disconnect(tunnel.id, account.id);

        assert(status == 508, `expected status 508, got ${status}`);
    });

    it('un-responsive target returns 502', async () => {
        assert(tunnel != undefined);
        assert(account != undefined);
        assert(tunnel.id != undefined);
        assert(account.id != undefined);

        forwardTo("localhost", 20001);
        await connectTunnel();

        const {status, data} = await httpRequest({
            hostname: 'localhost',
            port: 10000,
            method: 'GET',
            path: '/headers',
            headers: {
                "Host": `${tunnel.id}.localhost.example`,
            }
        });

        await tunnelService.disconnect(tunnel.id, account.id);

        assert(status == 502, `expected status 502, got ${status}`);
    });

    it('connection to non-existing tunnel returns 404', async () => {
        assert(tunnel != undefined);
        assert(account != undefined);

        const {status, data} = await httpRequest({
            hostname: 'localhost',
            port: 10000,
            method: 'GET',
            path: '/headers',
            headers: {
                "Host": `does-not-exist.localhost.example`,
            }
        });

        assert(status == 404, `expected status 404, got ${status}`);
    });

    it('non-connected tunnel returns 503', async () => {
        assert(tunnel != undefined);
        assert(account != undefined);

        const {status, data} = await httpRequest({
            hostname: 'localhost',
            port: 10000,
            method: 'GET',
            path: '/headers',
            headers: {
                "Host": `${tunnel.id}.localhost.example`,
            }
        });

        assert(status == 503, `expected status 503, got ${status}`);
    });

    it('disabled ingress returns 403', async () => {
        assert(tunnel != undefined);
        assert(account != undefined);
        assert(tunnel.id != undefined);
        assert(account.id != undefined);

        tunnel = await tunnelService.update(tunnel.id, account?.id, (config) => {
            config.ingress.http.enabled = false;
        });
        assert(tunnel instanceof Tunnel);
        assert(tunnel.id != undefined);

        forwardTo("localhost", 20000);
        await connectTunnel();

        const {status, data} = await httpRequest({
            hostname: 'localhost',
            port: 10000,
            method: 'GET',
            path: '/headers',
            headers: {
                "Host": `${tunnel.id}.localhost.example`,
            }
        });

        await tunnelService.disconnect(tunnel.id, account.id);

        assert(status == 403, `expected status 403, got ${status}`);
    });

});