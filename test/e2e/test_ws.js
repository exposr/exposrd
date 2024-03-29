import assert from 'assert/strict';
import crypto from 'crypto';
import http from 'node:http';
import { setTimeout } from 'timers/promises';
import { createAccount, createEchoServer, getAuthToken, getTunnel, putTunnel, startExposr } from './e2e-utils.js';
import { PGSQL_URL, REDIS_URL } from '../env.js';

const echoServerUrl = "http://host.docker.internal:10000";

describe('Websocket E2E', () => {
    let exposr;
    let terminator;
    let echoServerTerminator;

    before(async () => {
        process.env.NODE_ENV = "test-e2e";
        exposr = await import('../../src/index.js');
        echoServerTerminator = await createEchoServer();
    });

    after(async () => {
        process.env.NODE_ENV = "test";
        await echoServerTerminator()
    });

    const storageModes = [
        {storage: "In-memory storage", args: []},
        {storage: "Redis storage", args: ["--storage-url", REDIS_URL ]},
        {storage: "SQLite storage", args: ["--storage-url", "sqlite://db.sqlite" ]},
        {storage: "PostgreSQL storage", args: ["--storage-url", PGSQL_URL ]},
    ];

    storageModes.forEach(({storage, args}) => {
        it(`WS transport w/ HTTP ingress E2E w/ ${storage}`, async () => {
            terminator = await exposr.default([
                "node",
                "--admin-enable",
                "--allow-registration",
                "--ingress", "http",
                "--ingress-http-url", "http://localhost:8080"
            ].concat(args));

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

            exposrCliTerminator();
            await terminator(undefined, {gracefulTimeout: 10000, drainTimeout: 500});

            assert(status == 200, `expected status code 200, got ${status}`);
            assert(data == "echo", `did not get response from echo server through WS tunnel, got ${data}`);
        }).timeout(60000);
    });
});