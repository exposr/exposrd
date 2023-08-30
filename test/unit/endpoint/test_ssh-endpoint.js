import assert from 'assert/strict';
import Tunnel from '../../../src/tunnel/tunnel.js';
import SSHEndpoint from '../../../src/transport/ssh/ssh-endpoint.js';
import { initClusterService, initStorageService } from '../test-utils.ts'
import Config from '../../../src/config.js';
import Ingress from '../../../src/ingress/index.js';

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
            const storageService = await initStorageService();
            const clusterService = initClusterService();
            const ingress = new Ingress({
                http: {
                    enabled: true,
                    subdomainUrl: new URL("https://example.com"),
                    port: 8080,
                }
            });

            const tunnel = new Tunnel();
            tunnel.id = 'test';
            tunnel.transport.token = 'token';

            const endpoint = new SSHEndpoint(args);
            const ep = endpoint.getEndpoint(tunnel, baseUrl);
            endpoint.destroy();

            assert(ep.url == expected, `got ${ep.url}`);
            await storageService.destroy();
            await clusterService.destroy();
            await config.destroy();
            await ingress.destroy();
        });
    });
});