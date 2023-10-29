import assert from 'assert/strict';
import crypto from 'crypto';
import net from 'net';
import http from 'node:http';
import Config from '../../../src/config.js';
import TransportService from '../../../src/transport/transport-service.js'
import { createEchoHttpServer, initStorageService } from '../test-utils.js';
import ssh, { PasswordAuthMethod } from 'ssh2';
import ClusterService from '../../../src/cluster/index.js';
import { StorageService } from '../../../src/storage/index.js';
import AccountService from '../../../src/account/account-service.js';
import TunnelService from '../../../src/tunnel/tunnel-service.js';
import Ingress from '../../../src/ingress/index.js';
import Tunnel from '../../../src/tunnel/tunnel.js';
import Account from '../../../src/account/account.js';
import sinon from 'sinon';

describe('SSH transport', () => {
    let clock: sinon.SinonFakeTimers;
    let config: Config;
    let storageservice: StorageService;
    let clusterservice: ClusterService;
    let accountService: AccountService;
    let tunnelService: TunnelService;
    let echoServer: any;
    let ingress: Ingress;
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
        ingress = await new Promise((resolve, reject) => {
            const i = new Ingress({
                callback: (e: any) => {
                    e ? reject(e) : resolve(i) },
                http: {
                    enabled: true,
                    subdomainUrl: new URL("https://example.com"),
                    port: 8080,
                }
            });
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
        await ingress.destroy();
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

    it(`can create SSH transport`, async () => {
        const transportService = await createTransportService({
            ssh: {
                enabled: true,
                port: 2200,
            }
        });

        tunnel = await tunnelService.update(tunnelId, account.id, (tunnelConfig) => {
            tunnelConfig.transport.ssh.enabled = true;
            tunnelConfig.ingress.http.enabled = true;
        });

        const transports = transportService.getTransports(tunnel, "http://localhost");

        const conn = new ssh.Client();

        const readyWait = new Promise((resolve, reject) => {
            conn.once('ready', () => {
                conn.forwardIn('localhost', 20000, (err) => {
                    if (err) {
                        reject(err);
                    }
                    resolve(undefined);
                  });
            });
        });

        conn.connect({
            host: transports.ssh?.host,
            port: transports.ssh?.port,
            username: `${transports.ssh?.username}:${transports.ssh?.password}`
        });

        await readyWait;
        conn.on('tcp connection', (info, accept, reject) => {
            const sock = accept();
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

        assert(status == 200, "did not get response from echo server");
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

        assert(status2 == 200, `did not get 200 response from echo server, got ${status2}`);
        assert(data2.length == 1048576, "did not receive large file");

        conn.destroy();
        await transportService.destroy();
    });

    it(`can create SSH transport with password auth`, async () => {
        const transportService = await createTransportService({
            ssh: {
                enabled: true,
                port: 2200,
            }
        });

        tunnel = await tunnelService.update(tunnelId, account.id, (tunnelConfig) => {
            tunnelConfig.transport.ssh.enabled = true;
            tunnelConfig.ingress.http.enabled = true;
        });

        const transports = transportService.getTransports(tunnel, "http://localhost");

        const conn = new ssh.Client();

        const readyWait = new Promise((resolve, reject) => {
            conn.once('ready', () => {
                conn.forwardIn('localhost', 20000, (err) => {
                    if (err) {
                        reject(err);
                    }
                    resolve(undefined);
                  });
            });
        });

        const passwordAuth: PasswordAuthMethod = {
            type: 'password',
            username: `${transports.ssh?.username}`,
            password: `${transports.ssh?.password}`,
        }

        conn.connect({
            host: transports.ssh?.host,
            port: transports.ssh?.port,
            username: `${transports.ssh?.username}`,
            password: `${transports.ssh?.password}`,
            authHandler: [passwordAuth],
        });

        await readyWait;
        conn.on('tcp connection', (info, accept, reject) => {
            const sock = accept();
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

        conn.destroy();
        await transportService.destroy();
    });

    const sshConn = async (host: string, port: number, username: string, password: string): Promise<ssh.Client> => {

        const conn = new ssh.Client();

        const readyWait = new Promise((resolve, reject) => {
            conn.once('ready', () => {
                conn.forwardIn('localhost', 20000, (err) => {
                    if (err) {
                        reject(err);
                    }
                    resolve(undefined);
                  });
            });
        });

        const passwordAuth: PasswordAuthMethod = {
            type: 'password',
            username: `${username}`,
            password: `${password}`,
        }

        conn.connect({
            host: `${host}`,
            port: port,
            username: `${username}`,
            password: `${password}`,
            authHandler: [passwordAuth],
        });

        await readyWait;
        conn.on('tcp connection', (info, accept, reject) => {
            const sock = accept();
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

        return conn;
    };

    it(`can connect multiple SSH transports`, async () => {
        const transportService = await createTransportService({
            ssh: {
                enabled: true,
                port: 2200,
            }
        });

        tunnel = await tunnelService.update(tunnelId, account.id, (tunnelConfig) => {
            tunnelConfig.transport.ssh.enabled = true;
            tunnelConfig.ingress.http.enabled = true;
            tunnelConfig.target.url = "http://localhost:20000";
        });

        const tunnelId2 = crypto.randomBytes(20).toString('hex');
        let tunnel2 = await tunnelService.create(tunnelId2, account.id);

        tunnel2 = await tunnelService.update(tunnelId2, account.id, (tunnelConfig) => {
            tunnelConfig.transport.ssh.enabled = true;
            tunnelConfig.ingress.http.enabled = true;
        });

        let transports = transportService.getTransports(tunnel, "http://localhost");
        const conn = await sshConn(transports.ssh!?.host, transports.ssh!?.port, transports.ssh!?.username, transports.ssh!?.password);

        transports = transportService.getTransports(tunnel2, "http://localhost");
        const conn2 = await sshConn(transports.ssh!?.host, transports.ssh!?.port, transports.ssh!?.username, transports.ssh!?.password);

        do {
            await clock.tickAsync(1000);
            tunnel = await tunnelService.lookup(tunnelId);
        } while (tunnel.state.connected == false);

        do {
            await clock.tickAsync(1000);
            tunnel2 = await tunnelService.lookup(tunnelId);
        } while (tunnel2.state.connected == false);


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
            req.end(tunnel.id);
        });
        assert(status == 200, `did not get 200 response from echo server, ${status}`);
        assert(data == tunnel.id, "did not get response from echo server");

        let {status: status2, data: data2}: {status: number | undefined, data: any} = await new Promise((resolve) => {
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
            req.end(tunnel2.id);
        });
        assert(status2 == 200, `did not get 200 response from echo server, ${status}`);
        assert(data2 == tunnel2.id, "did not get response from echo server");

        conn.destroy();
        let clients: any;
        do {
            clients = transportService["transports"]["ssh"]?.["_clients"];
            await clock.tickAsync(100);
        } while (clients.length == 2);

        assert(clients.length == 1);

        conn2.destroy();
        do {
            clients = transportService["transports"]["ssh"]?.["_clients"];
            await clock.tickAsync(100);
        } while (clients.length == 1);

        assert(clients.length == 0, "client still connected");

        await transportService.destroy();
    });

    it(`handle TLS targets`, async () => {
        const secureEchoServer = await createEchoHttpServer(20001,
            new URL('../fixtures/cn-public-cert.pem', import.meta.url).pathname,
            new URL('../fixtures/cn-private-key.pem', import.meta.url).pathname,
            );

        const transportService = await createTransportService({
            ssh: {
                enabled: true,
                port: 2200,
                allowInsecureTarget: true,
            }
        });

        tunnel = await tunnelService.update(tunnelId, account.id, (tunnelConfig) => {
            tunnelConfig.transport.ssh.enabled = true;
            tunnelConfig.ingress.http.enabled = true;
            tunnelConfig.target.url = "https://localhost:20001";
        });

        const transports = transportService.getTransports(tunnel, "http://localhost");

        const conn = new ssh.Client();

        const readyWait = new Promise((resolve, reject) => {
            conn.once('ready', () => {
                conn.forwardIn('localhost', 20001, (err) => {
                    if (err) {
                        reject(err);
                    }
                    resolve(undefined);
                  });
            });
        });

        conn.connect({
            host: transports.ssh?.host,
            port: transports.ssh?.port,
            username: `${transports.ssh?.username}:${transports.ssh?.password}`
        });

        conn.on('tcp connection', (info, accept, reject) => {
            const sock = accept();
            const targetSock = new net.Socket();
            targetSock.connect({
                host: 'localhost',
                port: 20001
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
        await readyWait;

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

        conn.destroy();
        await transportService.destroy();
        await secureEchoServer.destroy();
    });
});