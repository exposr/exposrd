import assert from 'assert/strict';
import crypto from 'crypto';
import http from 'node:http';
import { setTimeout } from 'timers/promises';
import { createAccount, createEchoServer, getAuthToken, getTunnel, putTunnel, sshClient } from './e2e-utils.js';

const echoServerUrl = "http://localhost:10000";

describe('SSH transport E2E', () => {
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
            "--transport", "ssh",
            "--ingress", "http",
            "--ingress-http-url", "http://localhost:8080"
        ]);
        echoServerTerminator = await createEchoServer();
    });

    after(async () => {
        process.env.NODE_ENV = "test";
        await terminator(undefined, {gracefulTimeout: 1000, drainTimeout: 500});
        await echoServerTerminator()
    });

    it('SSH transport w/ HTTP ingress E2E', async () => {

        const account = await createAccount();
        let authToken = await getAuthToken(account.account_id);
        const tunnelId = crypto.randomBytes(20).toString('hex');
        let res = await putTunnel(authToken, tunnelId, {
            transport: {
              ssh: {
                enabled: true
              },
            },
            ingress: {
                http: {
                    enabled: true
                }
            },
            target: {
              url: `${echoServerUrl}`
            }
        });

        assert(res.status == 200, "could not create tunnel")

        res = await getTunnel(authToken, tunnelId);
        let data = await res.json();
        assert(data?.transport?.ssh?.enabled == true, "SSH transport not enabled");
        assert(typeof data?.transport?.ssh?.url == 'string', "No SSH connect URL available");

        const targetUrl = new URL(data.target.url);

        const terminateClient = sshClient(
            data?.transport?.ssh?.host,
            data?.transport?.ssh?.port,
            data?.transport?.ssh?.username,
            data?.transport?.ssh?.password,
            targetUrl,
        );

        authToken = await getAuthToken(account.account_id);
        do {
            await setTimeout(1000);
            res = await getTunnel(authToken, tunnelId);
            data = await res.json();
        } while (data?.connection?.connected == false);

        assert(data?.connection?.connected == true, "tunnel not connected");

        const ingressUrl = new URL(data.ingress.http.url);

        let status;
        ([status, data] = await new Promise((resolve) => {
            const req = http.request({
                hostname: 'localhost',
                port: 8080,
                method: 'POST',
                path: '/',
                headers: {
                    "Host": ingressUrl.hostname
                }
            }, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('close', () => { resolve([res.statusCode, data])});
            });
            req.end('echo');
        }));

        terminateClient();

        assert(status == 200, `expected status code 200, got ${status}`);
        assert(data == "echo", `did not get response from echo server through WS tunnel, got ${data}`);

    }).timeout(60000);
});