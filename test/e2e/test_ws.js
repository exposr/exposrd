import assert from 'assert/strict';
import crypto from 'crypto';
import { setTimeout } from 'timers/promises';
import { createAccount, createEchoServer, getAuthToken, getTunnel, putTunnel, startExposr } from './e2e-utils.js';

const echoServerUrl = "http://host.docker.internal:10000";

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
            "--ingress-http-url", "http://localhost:8080"
        ]);
        echoServerTerminator = await createEchoServer();
    });

    after(async () => {
        process.env.NODE_ENV = "test";
        await terminator(); 
        await echoServerTerminator()
    });

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