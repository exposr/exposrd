import assert from 'assert/strict';
import crypto from 'crypto';
import AccountService from "../../../src/account/account-service.js";
import EventBus from "../../../src/cluster/eventbus.js";
import Config from "../../../src/config.js";
import Ingress from "../../../src/ingress/index.js";
import TunnelService from "../../../src/tunnel/tunnel-service.js";
import { createEchoHttpServer, initClusterService, initStorageService, wsSocketPair, wsmPair } from "../../unit/test-utils.ts";
import { setTimeout } from 'timers/promises';
import sinon from 'sinon';
import net from 'net'
import http from 'http';

describe('http ingress', () => {
    let clock;
    let storageService;
    let clusterService;
    let config;
    let ingress;

    before(async () => {
        config = new Config();
        clusterService = initClusterService();
        storageService = await initStorageService();

        clock = sinon.useFakeTimers({shouldAdvanceTime: true});
        await new Promise((resolve, reject) => {
            ingress = new Ingress({
                callback: (err) => {
                    err ? reject(err) : resolve(ingress);
                },
                http: {
                    enabled: true,
                    port: 10000, 
                    httpAgentTTL: 5,
                    subdomainUrl: new URL("http://localhost.example")
                },
            });
        });
        assert(ingress instanceof Ingress);
    });

    after(async () => {
        await ingress.destroy();
        await clusterService.destroy();
        await storageService.destroy();
        await config.destroy();
        clock.restore();
    });

    let accountService;
    let tunnelService;
    let bus;
    let account
    let tunnel;


    beforeEach(async () => {
        tunnelService = new TunnelService();
        bus = new EventBus();
        accountService = new AccountService();

        account = await accountService.create();
        const tunnelId = crypto.randomBytes(20).toString('hex');
        tunnel = await tunnelService.create(tunnelId, account.id);
        tunnel = await tunnelService.update(tunnel.id, account.id, (tunnel) => {
            tunnel.ingress.http.enabled = true;
        });
    });

    afterEach(async () => {
        await bus.destroy();
        await tunnelService.destroy();
        await accountService.destroy();
        account = undefined;
        tunnel = undefined;
    });

    it('agent does not timeout during transfer', async () => {
        const sockPair = await wsSocketPair.create(9000)

        const [client, transport] = wsmPair(sockPair)

        let res = await tunnelService.connect(tunnel.id, account.id, transport, {peer: "127.0.0.1"});
        assert(res == true, "failed to connect tunnel");

        let i = 0;
        let tun;
        do {
            await setTimeout(100);
            tun = await tunnelService._get(tunnel.id)
        } while (tun.state.connected == false && i++ < 10);
        assert(tun.state.connected == true, "tunnel not connected")

        client.on('connection', (sock) => {
            sock.on('data', async (chunk) => {
                //console.log(chunk.toString());
                sock.write("HTTP/1.1 200\r\nContent-Length: 2\r\n\r\n");
                sock.write("A");
                await clock.tickAsync(12500);
                sock.write("A");
                sock.end();
            });
        });

        let [status, data] = await new Promise((resolve) => {
            const req = http.request({
                hostname: 'localhost',
                port: 10000,
                method: 'GET',
                path: '/',
                headers: {
                    "Host": `${tunnel.id}.localhost.example`
                }
            }, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('close', () => { resolve([res.statusCode, data])});
            });
            req.end('echo');
        });

        await client.destroy();
        await transport.destroy();
        await sockPair.terminate();

        assert(status == 200, `expected status code 200, got ${status}`);
        assert(data == "AA", `did not get expected reply, got ${data}`);

    }).timeout(2000);

    it(`http ingress can handle websocket upgrades`, async () => {
        const sockPair = await wsSocketPair.create(9000)
        const [sock1, sock2] = wsmPair(sockPair)
        const echoServer = await createEchoHttpServer(20000);

        sock2.on('connection', (sock) => {
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

        let res = await tunnelService.connect(tunnel.id, account.id, sock1, {peer: "127.0.0.1"});
        assert(res == true, "failed to connect tunnel");

        let i = 0;
        let tun;
        do {
            await setTimeout(100);
            tun = await tunnelService._get(tunnel.id)
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

        const done = (resolve) => {
            req.on('upgrade', (res, socket, head) => {
                const body = head.subarray(2);
                resolve(body);
            });
        };
        req.end();

        const wsRes = await new Promise(done);
        assert(wsRes.equals(Buffer.from("ws echo connected")), `did not get ws echo, got ${wsRes}`);

        await sock1.destroy();
        await sock2.destroy();
        await sockPair.terminate();
        await echoServer.destroy();
    });
});