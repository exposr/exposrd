import SNIIngress, { SniIngressOptions } from '../../../src/ingress/sni-ingress.js';
import Tunnel from '../../../src/tunnel/tunnel.js';
import assert from 'assert/strict';
import { X509Certificate } from 'crypto';
import fs from 'fs';
import crypto from 'crypto';
import net from 'net';
import tls, { TLSSocket } from 'tls';
import { createEchoHttpServer, initStorageService, wsSocketPair, wsmPair } from '../test-utils.js'
import Config from '../../../src/config.js';
import IngressManager, { IngressType } from '../../../src/ingress/ingress-manager.js';
import { StorageService } from '../../../src/storage/index.js';
import TunnelService from '../../../src/tunnel/tunnel-service.js';
import Account from '../../../src/account/account.js';
import AccountService from '../../../src/account/account-service.js';
import sinon from 'sinon';
import { WebSocketMultiplex } from '@exposr/ws-multiplex';
import WebSocketTransport from '../../../src/transport/ws/ws-transport.js';
import { Duplex } from 'stream';
import { httpRequest } from './utils.js';
import TunnelConnectionManager from '../../../src/tunnel/tunnel-connection-manager.js';
import ClusterManager, { ClusterManagerType } from '../../../src/cluster/cluster-manager.js';

describe('sni', () => {

    describe('cert parser', () => {
        it("_getWildcardSubjects parses CN correctly", () => {
            const cert = fs.readFileSync(new URL('../fixtures/cn-public-cert.pem', import.meta.url));
            const wild = SNIIngress['_getWildcardSubjects'](new X509Certificate(cert));

            assert(wild.length == 1);
            assert(wild[0] == '*.example.com');
        });

        it("_getWildcardSubjects parses SAN correctly", () => {
            const cert = fs.readFileSync(new URL('../fixtures/san-public-cert.pem', import.meta.url));
            const wild = SNIIngress['_getWildcardSubjects'](new X509Certificate(cert));

            assert(wild.length == 2);
            assert(wild[0] == '*.example.com');
            assert(wild[1] == '*.localhost');
        });

        it("_getWildcardSubjects returns nothing for non-wildcard cert", () => {
            const cert = fs.readFileSync(new URL('../fixtures/no-wildcard-public-cert.pem', import.meta.url));
            const wild = SNIIngress['_getWildcardSubjects'](new X509Certificate(cert));

            assert(wild.length == 0);
        });
    });

    describe('baseUrl', () => {
        const urlTests = [
            {
                args: {
                    cert: new URL('../fixtures/cn-public-cert.pem', import.meta.url).pathname,
                    key: new URL('../fixtures/cn-private-key.pem', import.meta.url).pathname,
                },
                expected: "tcps://test.example.com:4430",
            },
            {
                args: {
                    cert: new URL('../fixtures/cn-public-cert.pem', import.meta.url).pathname,
                    key: new URL('../fixtures/cn-private-key.pem', import.meta.url).pathname,
                    port: 44300,
                },
                expected: "tcps://test.example.com:44300",
            },
            {
                args: {
                    cert: new URL('../fixtures/cn-public-cert.pem', import.meta.url).pathname,
                    key: new URL('../fixtures/cn-private-key.pem', import.meta.url).pathname,
                    port: 4430,
                    host: 'example.com:443',
                },
                expected: "tcps://test.example.com:443",
            },
            {
                args: {
                    cert: new URL('../fixtures/cn-public-cert.pem', import.meta.url).pathname,
                    key: new URL('../fixtures/cn-private-key.pem', import.meta.url).pathname,
                    port: 4430,
                    host: 'tcp://example.com:443',
                },
                expected: "tcps://test.example.com:443",
            },
        ];

        urlTests.forEach(({args, expected}) => {
            it(`baseurl for ${JSON.stringify(args)} returns ${expected}`, async () => {
                let storageService: StorageService;
                let tunnelService: TunnelService;
                let accountService: AccountService;
                let config: Config;
                let account: Account | undefined;
                let tunnel: Tunnel;

                config = new Config();
                storageService = await initStorageService();
                await ClusterManager.init(ClusterManagerType.MEM);
                await IngressManager.listen({
                    sni: {
                        enabled: true,
                        ...(args as SniIngressOptions)
                    }
                });

                tunnelService = new TunnelService();
                accountService = new AccountService();

                account = await accountService.create();
                assert(account != undefined);

                const tunnelId = 'test';
                tunnel = await tunnelService.create(tunnelId, account.id);
                tunnel = await tunnelService.update(tunnel.id, account.id, (tunnel) => {
                    tunnel.ingress.sni.enabled = true;
                });

                const url = IngressManager.getIngress(IngressType.INGRESS_SNI).getBaseUrl(tunnel.id);

                await tunnelService.delete(tunnelId, account?.id);

                await accountService.destroy();
                await tunnelService.destroy();
                await IngressManager.close();
                await storageService.destroy();
                await ClusterManager.close();
                config.destroy();

                assert(url?.href == expected, `expected ${expected}, got ${url?.href}`);

                return true;
            });
        });
    });

    describe('ingress', () => {
        let storageService: StorageService;
        let config: Config;
        let echoServer: { destroy: () => Promise<void>; };

        let sockPair: wsSocketPair;
        let client: WebSocketMultiplex;
        let transport: WebSocketTransport;

        before(async () => {
            clock = sinon.useFakeTimers({shouldAdvanceTime: true});
            config = new Config();
            storageService = await initStorageService();
            await ClusterManager.init(ClusterManagerType.MEM);
            await TunnelConnectionManager.start();
            await IngressManager.listen({
                sni: {
                    enabled: true,
                    port: 4430,
                    cert: new URL('../fixtures/cn-public-cert.pem', import.meta.url).pathname,
                    key: new URL('../fixtures/cn-private-key.pem', import.meta.url).pathname,
                }
            });

            echoServer = await createEchoHttpServer(20000);
        });

        after(async () => {
            await storageService.destroy();
            await ClusterManager.close();
            await TunnelConnectionManager.stop();
            await IngressManager.close();
            config.destroy()
            clock.restore();
            await echoServer.destroy();
        });

        let clock: sinon.SinonFakeTimers;
        let accountService: AccountService;
        let tunnelService: TunnelService;
        let account: Account | undefined;
        let tunnel: Tunnel | undefined;

        beforeEach(async () => {
            tunnelService = new TunnelService();
            accountService = new AccountService();
    
            account = await accountService.create();
            assert(account != undefined);
            const tunnelId = crypto.randomBytes(20).toString('hex');
            tunnel = await tunnelService.create(tunnelId, account.id);
            tunnel = await tunnelService.update(tunnel.id, account.id, (tunnel) => {
                tunnel.ingress.sni.enabled = true;
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

        const connectTunnel = async (): Promise<void> => {
            assert(tunnel != undefined);
            assert(account != undefined);
    
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

        it(`can send traffic`, async () => {
            assert(tunnel != undefined);
            assert(account != undefined);
    
            forwardTo("localhost", 20000);
            await connectTunnel();

            const url = new URL(`${tunnel.config.ingress.sni.url}`);

            const tlsSock = await new Promise((resolve: (sock: TLSSocket) => void) => {
                const sock = tls.connect({
                    servername: url.hostname, 
                    host: 'localhost',
                    port: Number.parseInt(url.port),
                    checkServerIdentity: () => undefined,
                    rejectUnauthorized: false,
                }, () => {
                    resolve(sock);
                });
            });

            const {status, data} = await httpRequest({
                method: 'GET',
                path: '/file?size=1048576',
                createConnection: () => { return tlsSock; },
            });

            await tunnelService.disconnect(tunnel.id, account.id);

            assert(status == 200, `expected 200 status, got ${status}`);
            assert(data.length == 1048576, `did not receive expected data, got data length ${data.length}`);
        });

        it(`tls handshake fails for non-connected tunnel`, async () => {

            const err = await new Promise((resolve: (result: Error | undefined) => void) => {
                const sock = tls.connect({
                    servername: `test.example`, 
                    host: 'localhost',
                    port: 4430,
                }, () => {
                    resolve(undefined);
                });

                sock.once('error', (err: Error) => {
                    resolve(err)
                });
            });

            assert(err != undefined);
            assert((<any>err).code == 'ECONNRESET');
        });

        it(`tls handshake fails for disabled ingress`, async () => {
            assert(tunnel != undefined);
            assert(account != undefined);

            const url = new URL(`${tunnel.config.ingress.sni.url}`);

            tunnel = await tunnelService.update(tunnel.id, account?.id, (config) => {
                config.ingress.sni.enabled = false;
            });

            forwardTo("localhost", 20000);
            await connectTunnel();

            const err = await new Promise((resolve: (result: Error | undefined) => void) => {
                const sock = tls.connect({
                    servername: url.hostname, 
                    host: 'localhost',
                    port: Number.parseInt(url.port),
                    checkServerIdentity: () => undefined,
                    rejectUnauthorized: false,
                }, () => {
                    resolve(undefined);
                });

                sock.once('error', (err: Error) => {
                    resolve(err)
                });
            });

            await tunnelService.disconnect(tunnel.id, account.id);

            assert(err != undefined);
            assert((<any>err).code == 'ECONNRESET');
        });

    });
});