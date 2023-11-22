import child_process from 'child_process';
import crypto from 'crypto';
import assert from 'assert/strict';
import http from 'http';
import https from 'https';
import { setTimeout } from 'timers/promises';
import { createAccount, exposrCliImageTag, getAuthToken, getTunnel, putTunnel } from './e2e-utils.js';
import { createEchoHttpServer } from '../unit/test-utils.js';

const startExposrd = (name = "", network, args = [], dockerargs = []) => {
    const obj = child_process.spawn("docker", [
        "run", "--rm", "-t", "-v", `${process.cwd()}:/app`, "--name", name, "--network", network,
        "--workdir", "/app",
        "--add-host", "host.docker.internal:host-gateway",
    ].concat(dockerargs).concat([
        "node:20-alpine3.18",
        "exposrd.mjs"
    ]).concat(args), {detached: true});

    let buf = '';
    obj.stderr.on('data', (data) => {
        console.log(data.toString('utf-8'));
    });
    obj.stdout.on('data', (data) => {
        data = buf + data.toString('utf-8');
        if (data.indexOf('\n') != -1) {
            console.log(`${name}: "${data.slice(0, -1)}"`);
        } else {
            buf = data;
        }
    })

    return {
        terminate: () => {
            child_process.spawnSync("docker", ["kill", name]);
        }
    };
};

export const startExposr = (server, network, args) => {
    const name = crypto.randomBytes(20).toString('hex');
    const obj = child_process.spawn("docker", [
        "run", "--rm", "-t", "--add-host", "host.docker.internal:host-gateway",
        "--name", name,
        "--net", network,
        `ghcr.io/exposr/exposr:${exposrCliImageTag}`,
        "--non-interactive",
        "-s", server,
    ].concat(args), {detached: true});

    let buf = '';
    obj.stdout.on('data', (data) => {
        data = buf + data.toString('utf-8');
        if (data.indexOf('\n') != -1) {
            console.log(`exposr-cli output "${data.slice(0, -1)}"`);
        } else {
            buf = data;
        }
    })

    return () => {
        child_process.spawnSync("docker", ["kill", name]);
    };
};

describe('Cluster E2E', () => {

    const redisUrl = "redis://host.docker.internal:6379";

    let network;
    before(() => {
        network = crypto.randomBytes(20).toString('hex');
        child_process.spawnSync("docker", [
            "network", "create", network
        ]);
    });

    after(() => {
        child_process.spawnSync("docker", [
            "network", "rm", network
        ]);
    });

    const clusterModes = [
        {mode: "UDP/multicast", ingress: 'http', args: ["--cluster", "udp"]},
        {mode: "UDP/multicast", ingress: 'sni', args: ["--cluster", "udp"]},
        {mode: "Redis pub/sub", ingress: 'http', args: ["--cluster", "redis", "--cluster-redis-url", redisUrl ]},
        {mode: "Redis pub/sub", ingress: 'sni', args: ["--cluster", "redis", "--cluster-redis-url", redisUrl ]},
    ];

    // Test will
    // Spawn two nodes, with the given cluster method
    // Connect a tunnel client to the second node
    // Perform a http ingress request to the first node
    // Assert that a http response is received
    clusterModes.forEach(({mode, ingress, args}) => {
        it(`Cluster mode ${mode} w/ redis storage, ingress ${ingress}`, async () => {
            const node1 = startExposrd("node-1", network, [
                "--log-level", "debug",
                "--storage-url", redisUrl,
                "--allow-registration",
                "--ingress", "http,sni",
                "--ingress-http-url", "http://localhost:8080",
                "--ingress-sni-cert", "test/unit/fixtures/cn-public-cert.pem",
                "--ingress-sni-key", "test/unit/fixtures/cn-private-key.pem",
            ].concat(args), [
                "-p", "8080:8080",
                "-p", "4430:4430"
            ]);

            const node2 = startExposrd("node-2", network, [
                "--log-level", "debug",
                "--storage-url", redisUrl,
                "--allow-registration",
                "--ingress", "http,sni",
                "--ingress-http-url", "http://localhost:8080",
                "--ingress-sni-cert", "test/unit/fixtures/cn-public-cert.pem",
                "--ingress-sni-key", "test/unit/fixtures/cn-private-key.pem",
            ].concat(args));

            const echoServer = await createEchoHttpServer();

            const apiEndpoint = "http://localhost:8080";
            const echoServerUrl = "http://host.docker.internal:20000";

            let retries = 60;
            do {
                await setTimeout(1000);
                try {
                    const res = await fetch(`${apiEndpoint}`);
                    break;
                } catch (e) {}
            } while (retries-- > 0);

            const account = await createAccount(apiEndpoint);
            let authToken = await getAuthToken(account.account_id, apiEndpoint);
            const tunnelId = crypto.randomBytes(20).toString('hex');
            await putTunnel(authToken, tunnelId, {}, apiEndpoint);

            const exposrCliTerminator = startExposr(
                'http://node-2:8080', network, [
                "-a", `${account.account_id}`,
                "tunnel", "connect", `${tunnelId}`, `${echoServerUrl}`,
                "ingress-http", "enable",
                "ingress-sni", "enable",
            ]);

            authToken = await getAuthToken(account.account_id, apiEndpoint);
            let res, data;
            do {
                await setTimeout(1000);
                res = await getTunnel(authToken, tunnelId, apiEndpoint);
                data = await res.json();
            } while (data?.connection?.connected == false);

            assert(data?.connection?.connected == true, "tunnel not connected");

            const ingressUrl = new URL(data.ingress.http.url);
            const sniIngressUrl = new URL(data.ingress.sni.url);

            let status;
            ([status, data] = await new Promise((resolve, reject) => {
                const onRes = (res) => {
                    let data = '';
                    res.on('data', (chunk) => {
                        data += chunk;
                    });

                    res.on('close', () => { resolve([res.statusCode, data])});
                };

                let req;
                if (ingress == 'sni') {
                    req = https.request({
                        hostname: 'localhost',
                        port: 4430,
                        method: 'POST',
                        path: '/',
                        headers: {
                            "Host": sniIngressUrl.hostname
                        },
                        servername: sniIngressUrl.hostname,
                        rejectUnauthorized: false,
                    }, onRes);
                } else {
                    req = http.request({
                        hostname: 'localhost',
                        port: 8080,
                        method: 'POST',
                        path: '/',
                        headers: {
                            "Host": ingressUrl.hostname
                        },
                        rejectUnauthorized: false,
                    }, onRes);
                }
                req.on('error', (err) => {
                    console.log(err);
                    reject(err)
                })
                req.end('echo');
            }));

            exposrCliTerminator();
            node1.terminate();
            node2.terminate();
            await echoServer.destroy();

            assert(status == 200, `expected status code 200, got ${status}`);
            assert(data == "echo", `did not get response from echo server through WS tunnel, got ${data}`);
        }).timeout(120000);
    });
});