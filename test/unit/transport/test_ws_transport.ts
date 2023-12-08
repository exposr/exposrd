import assert from 'assert/strict';
import crypto from 'crypto';
import net from 'net';
import http from 'node:http';
import WebSocket from 'ws';
import Config from '../../../src/config.js';
import TransportService from '../../../src/transport/transport-service.js'
import { createEchoHttpServer, initStorageService } from '../test-utils.js';
import ClusterService from '../../../src/cluster/index.js';
import { StorageService } from '../../../src/storage/index.js';
import AccountService from '../../../src/account/account-service.js';
import TunnelService from '../../../src/tunnel/tunnel-service.js';
import Tunnel from '../../../src/tunnel/tunnel.js';
import Account from '../../../src/account/account.js';
import sinon from 'sinon';
import { WebSocketMultiplex } from '@exposr/ws-multiplex';
import { Duplex } from 'stream';
import IngressManager from '../../../src/ingress/ingress-manager.js';
import TunnelConnectionManager from '../../../src/tunnel/tunnel-connection-manager.js';

describe('WS transport', () => {
    let clock: sinon.SinonFakeTimers;
    let config: Config;
    let storageservice: StorageService;
    let clusterservice: ClusterService;
    let accountService: AccountService;
    let tunnelService: TunnelService;
    let echoServer: any;
    let account: Account;
    let tunnel: Tunnel;
    let tunnelId: string;

    beforeEach(async () => {
        clock = sinon.useFakeTimers({shouldAdvanceTime: true});
        config = new Config([
            "--log-level", "debug"
        ]);
        storageservice = await initStorageService();
        clusterservice = new ClusterService('mem', {});

        await TunnelConnectionManager.start();
        await IngressManager.listen({
            http: {
                enabled: true,
                subdomainUrl: new URL("https://example.com"),
                port: 8080,
            }
        });
        accountService = new AccountService();
        tunnelService = new TunnelService();

        echoServer = await createEchoHttpServer();

        account = <any>await accountService.create();
        tunnelId = crypto.randomBytes(20).toString('hex');
        tunnel = await tunnelService.create(tunnelId, account.id);
    });

    afterEach(async () => {
        await tunnelService.destroy();
        await accountService.destroy();
        await IngressManager.close(); 
        await TunnelConnectionManager.stop();
        await clusterservice.destroy();
        await storageservice.destroy();
        await config.destroy();
        await echoServer.destroy();
        clock.restore();
    });

    const createTransportService = async (opts: any): Promise<TransportService> => {
        return new Promise((resolve, reject) => {
            let transportService: TransportService;
            const defaultOptions = {
                max_connections: 1,
                ws: {
                    enabled: false,
                    baseUrl: "",
                    port: 8080,
                },
                ssh: {
                    enabled: false,
                    port: 2200,
                },
                callback: (err?: Error) => { err ? reject() : resolve(transportService) }
            }
            transportService = new TransportService({...defaultOptions, ...opts});
        })
    };

    it(`can create WS transport`, async () => {
        const transportService = await createTransportService({
            ws: {
                enabled: true,
                port: 8080,
                baseUrl: "http://localhost"
            }
        });

        tunnel = await tunnelService.update(tunnelId, account.id, (tunnelConfig) => {
            tunnelConfig.transport.ws.enabled = true;
            tunnelConfig.ingress.http.enabled = true;
        });

        const transports = transportService.getTransports(tunnel, "http://localhost:8080");

        assert(transports?.ws?.url != undefined, "ws url is undefined");

        const ws = new WebSocket(transports.ws.url)
        ws.once('open', () => {
            const wsm = new WebSocketMultiplex(ws);
            wsm.on('connection', (sock: Duplex) => {
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
        });

        do {
            await clock.tickAsync(1000);
            tunnel = await tunnelService.lookup(tunnelId);
        } while (tunnel.state.connected == false);

        let {status, data}: {status: number | undefined, data: any} = await new Promise((resolve) => {
            const req = http.request({
                hostname: 'localhost',
                port: 8080,
                method: 'POST',
                path: '/',
                headers: {
                    "Host": `${tunnel.id}.example.com`
                }
            }, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('close', () => { resolve({status: res.statusCode, data})});
            });
            req.end('echo');
        });

        assert(status == 200, `did not get 200 response from echo server, ${status}`);
        assert(data == 'echo', "did not get response from echo server");

        let {status: status2, data: data2}: {status: number | undefined, data: any} = await new Promise((resolve) => {
            const req = http.request({
                hostname: 'localhost',
                port: 8080,
                method: 'GET',
                path: '/file?size=1048576',
                headers: {
                    "Host": `${tunnel.id}.example.com`
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

        ws.close();
        await transportService.destroy();

        assert(status2 == 200, `did not get 200 response from echo server, got ${status2}`);
        assert(data2.length == 1048576, "did not receive large file");
    });
});