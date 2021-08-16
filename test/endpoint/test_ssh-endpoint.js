import assert from 'assert/strict';
import Tunnel from '../../src/tunnel/tunnel.js';
import SSHEndpoint from '../../src/endpoint/ssh-endpoint.js';

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
        it(`getEndpoint() for ${JSON.stringify(args)}, ${baseUrl} returns ${expected}`, () => {
            const tunnel = new Tunnel();
            tunnel.id = 'test';
            tunnel.endpoints.token = 'token';

            const endpoint = new SSHEndpoint(args);
            const ep = endpoint.getEndpoint(tunnel, baseUrl);
            endpoint.destroy();

            assert(ep.url == expected, `got ${ep.url}`);

        });
    });
});