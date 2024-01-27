import assert from 'assert/strict';
import Tunnel from '../../../src/tunnel/tunnel.js';
import SSHEndpoint from '../../../src/transport/ssh/ssh-endpoint.js';
import Config from '../../../src/config.js';
import IngressManager from '../../../src/ingress/ingress-manager.js';
import { TunnelConfig } from '../../../src/tunnel/tunnel-config.js';
import ClusterManager, { ClusterManagerType } from '../../../src/cluster/cluster-manager.js';
import StorageManager from '../../../src/storage/storage-manager.js';

describe('ssh endpoint', () => {

    const endpointTests = [
        {
            args: {port: 2200},
            baseUrl: new URL('http://example.com'),
            expected: "ssh://test:token@example.com:2200",
        },
        {
            args: {port: 2200, host: 'localhost'},
            baseUrl: new URL('http://example.com'),
            expected: "ssh://test:token@localhost:2200",
        },
        {
            args: {port: 2200, host: 'localhost:22'},
            baseUrl: new URL('http://example.com'),
            expected: "ssh://test:token@localhost:22",
        },
        {
            args: {port: 2200},
            baseUrl: new URL('http://example.com:8080'),
            expected: "ssh://test:token@example.com:2200",
        },
        {
            args: {port: 2200, host: 'localhost:22'},
            baseUrl: new URL('http://example.com:8080'),
            expected: "ssh://test:token@localhost:22",
        },
    ];

    endpointTests.forEach(({args, baseUrl, expected}) => {
        it(`getEndpoint() for ${JSON.stringify(args)}, ${baseUrl} returns ${expected}`, async () => {
            const config = new Config();
            await StorageManager.init(new URL("memory://"));
            await ClusterManager.init(ClusterManagerType.MEM);
            await IngressManager.listen({
                http: {
                    enabled: true,
                    subdomainUrl: new URL("https://example.com"),
                    port: 8080,
                }
            });

            const tc = new TunnelConfig("test", "test");
            tc.transport.token = 'token';
            const tunnel = new Tunnel(tc)

            const endpoint = new SSHEndpoint({
                ...args,
                max_connections: 1,
                enabled: true,
                hostKey: "",
                allowInsecureTarget: true,
            });
            const ep = endpoint.getEndpoint(tunnel, baseUrl);
            await endpoint.destroy();

            assert(ep.url == expected, `got ${ep.url}`);
            await StorageManager.close();
            await ClusterManager.close();
            await IngressManager.close();
            await config.destroy();
        });
    });
});