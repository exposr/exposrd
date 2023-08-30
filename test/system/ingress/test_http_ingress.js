import assert from 'assert/strict';
import crypto from 'crypto';
import AccountService from "../../../src/account/account-service.js";
import EventBus from "../../../src/cluster/eventbus.js";
import Config from "../../../src/config.js";
import Ingress from "../../../src/ingress/index.js";
import TunnelService from "../../../src/tunnel/tunnel-service.js";
import { initClusterService, initStorageService, wsSocketPair, wsmPair } from "../../unit/test-utils.ts";
import WebSocketTransport from '../../../src/transport/ws/ws-transport.js';
import { setTimeout } from 'timers/promises';
import sinon from 'sinon';

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
        } while (tun.state().connected == false && i++ < 10);
        assert(tun.state().connected == true, "tunnel not connected")

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

        res = await fetch("http://127.0.0.1:10000", {
            method: "GET",
            headers: {
                Host: `${tunnel.id}.localhost.example`
            }
        });

        const data = await res.text();
        assert(data == "AA", `did not get expected reply, got ${data}`);

        await client.destroy();
        await transport.destroy();
        await sockPair.terminate();

    }).timeout(2000);
});