import assert from 'assert/strict';
import crypto from 'crypto';
import child_process from 'child_process';
import { setTimeout } from 'timers/promises';
import http from 'http';

const baseApi = "http://localhost:8080";
const echoServerUrl = "http://host.docker.internal:10000";

const createEchoServer = async (port = 10000) => {
    const server = http.createServer();

    server.on('request', (request, response) => {
        let body = [];
        request.on('data', (chunk) => {
            body.push(chunk);
        }).on('end', () => {
            body = Buffer.concat(body).toString();
            response.statusCode = 200;
            response.end(body);
        });
    }).listen(port);

    return async () => {
        server.removeAllListeners('request');
        server.close();
    };
};

describe('Websocket E2E', () => {
    let exposr;
    let terminator;
    let echoServerTerminator;

    before(async () => {
        process.env.NODE_ENV = "test-e2e";
        exposr = await import('../../src/index.js');
        terminator = await exposr.default([
            "node",
            "--admin-enable",
            "--allow-registration",
            "--ingress", "http",
            "--ingress-http-domain", "http://localhost:8080"
        ]);
        echoServerTerminator = await createEchoServer();
    });

    after(async () => {
        process.env.NODE_ENV = "test";
        await terminator(); 
        await echoServerTerminator()
    });

    const createAccount = async () => {
        try {
        const res = await fetch(`${baseApi}/v1/account`, {
            method: 'POST'
        });
        return res.json();
        } catch (e) {
            console.log(e);
        }
    };

    const getAuthToken = async (accountId) => {
        const res = await fetch(`${baseApi}/v1/account/${accountId}/token`);
        const data = await res.json();
        return data.token;
    };

    const putTunnel = async (authToken, tunnelId, opts = {}) => {
        const res = await fetch(`${baseApi}/v1/tunnel/${tunnelId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(opts)
        });
        return res;
    }

    const getTunnel = async(authToken, tunnelId) => {
        const res = await fetch(`${baseApi}/v1/tunnel/${tunnelId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken}`
            },
        });
        return res;
    };

    const startExposr = (args) => {
        const obj = child_process.spawn("docker", ["run", "--rm", "-t", "--add-host", "host.docker.internal:host-gateway", "exposr/exposr:latest",
            "--non-interactive",
            "-s", "http://host.docker.internal:8080",
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
            process.kill(-obj.pid, 'SIGKILL');
        };
    };

    it('WS transport w/ HTTP ingress E2E', async () => {
        const account = await createAccount();
        let authToken = await getAuthToken(account.account_id);
        const tunnelId = crypto.randomBytes(20).toString('hex');
        await putTunnel(authToken, tunnelId);

        const exposrCliTerminator = startExposr([
            "-a", `${account.account_id}`,
            "tunnel", "connect", `${tunnelId}`, `${echoServerUrl}`
        ]);

        authToken = await getAuthToken(account.account_id);
        let res, data;
        do {
            await setTimeout(1000);
            res = await getTunnel(authToken, tunnelId);
            data = await res.json(); 
        } while (data?.connection?.connected == false);

        assert(data?.connection?.connected == true, "tunnel not connected");

        const ingressUrl = new URL(data.ingress.http.url);

        res = await fetch("http://localhost:8080", {
            method: 'POST',
            headers: {
                "Host": ingressUrl.hostname
            },
            body: "echo" 
        })

        assert(res.status == 200, `expected status code 200, got ${res.status}`);
        data = await res.text()
        assert(data == "echo", `did not get response from echo server through WS tunnel, got ${data}`) 

        exposrCliTerminator();

    }).timeout(60000);
});