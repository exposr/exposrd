import child_process from 'child_process';
import crypto from 'crypto';
import assert from 'assert/strict';
import { setTimeout } from 'timers/promises';
import { createAccount, createEchoServer, getAuthToken, getTunnel, putTunnel } from './e2e-utils.js';

const startExposrd = (name = "", network, args = [], dockerargs = []) => {
    const obj = child_process.spawn("docker", [
        "run", "--rm", "-t", "-v", `${process.cwd()}:/app`, "--name", name, "--network", network,
        "--add-host", "host.docker.internal:host-gateway",
    ].concat(dockerargs).concat([
        "node:18-alpine3.17",
        "/app/exposr-server.js"
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
        "exposr/exposr:latest",
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
        {mode: "UDP/multicast", args: ["--cluster", "udp"]},
        {mode: "Redis pub/sub", args: ["--cluster", "redis", "--cluster-redis-url", redisUrl, ]}
    ]

    // Test will
    // Spawn two nodes, with the given cluster method
    // Connect a tunnel client to the second node
    // Perform a http ingress request to the first node 
    // Assert that a http response is received
    clusterModes.forEach(({mode, args}) => {
        it(`Cluster mode ${mode} w/ redis storage`, async () => {
            const node1 = startExposrd("node-1", network, [
                "--log-level", "debug",
                "--storage", "redis",
                "--storage-redis-url", redisUrl, 
                "--allow-registration",
                "--ingress", "http",
                "--ingress-http-url", "http://localhost:8080",
            ].concat(args), [
                "-p", "8080:8080"
            ]);

            const node2 = startExposrd("node-2", network, [
                "--log-level", "debug",
                "--storage", "redis",
                "--storage-redis-url", redisUrl, 
                "--allow-registration",
                "--ingress", "http",
                "--ingress-http-url", "http://localhost:8080",
            ].concat(args));

            const echoServerTerminate = await createEchoServer();

            const apiEndpoint = "http://localhost:8080";
            const echoServerUrl = "http://host.docker.internal:10000";

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
                "tunnel", "connect", `${tunnelId}`, `${echoServerUrl}`
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

            res = await fetch("http://localhost:8080", {
                method: 'POST',
                headers: {
                    "Host": `${ingressUrl.hostname}:8080`
                },
                body: "echo" 
            })

            assert(res.status == 200, `expected status code 200, got ${res.status}`);
            data = await res.text()
            assert(data == "echo", `did not get response from echo server through WS tunnel, got ${data}`) 

            exposrCliTerminator();
            await echoServerTerminate();
            node1.terminate();
            node2.terminate();
        }).timeout(120000);

    }); 

});