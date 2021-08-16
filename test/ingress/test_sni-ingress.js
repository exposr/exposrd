import SNIIngress from '../../src/ingress/sni-ingress.js';
import Tunnel from '../../src/tunnel/tunnel.js';
import assert from 'assert/strict';
import { X509Certificate } from 'crypto';
import fs from 'fs';

describe('sni ingress', () => {

    it("_getWildcardSubjects parses CN correctly", () => {
        const cert = fs.readFileSync(new URL('../fixtures/cn-public-cert.pem', import.meta.url));
        const wild = SNIIngress._getWildcardSubjects(new X509Certificate(cert));

        assert(wild.length == 1);
        assert(wild[0] == '*.example.com');
    });

    it("_getWildcardSubjects parses SAN correctly", () => {
        const cert = fs.readFileSync(new URL('../fixtures/san-public-cert.pem', import.meta.url));
        const wild = SNIIngress._getWildcardSubjects(new X509Certificate(cert));

        assert(wild.length == 2);
        assert(wild[0] == '*.example.com');
        assert(wild[1] == '*.localhost');
    });

    it("_getWildcardSubjects returns nothing for non-wildcard cert", () => {
        const cert = fs.readFileSync(new URL('../fixtures/no-wildcard-public-cert.pem', import.meta.url));
        const wild = SNIIngress._getWildcardSubjects(new X509Certificate(cert));

        assert(wild.length == 0);
    });

    it("construct instance with valid certificates", async () => {
        const sni = new SNIIngress({
            cert: new URL('../fixtures/cn-public-cert.pem', import.meta.url),
            key: new URL('../fixtures/cn-private-key.pem', import.meta.url),
        });
        return sni.destroy();
    });

    const urlTests = [
        {
            args: {
                cert: new URL('../fixtures/cn-public-cert.pem', import.meta.url),
                key: new URL('../fixtures/cn-private-key.pem', import.meta.url),
            },
            expected: "tcps://test.example.com:4430",
        },
        {
            args: {
                cert: new URL('../fixtures/cn-public-cert.pem', import.meta.url),
                key: new URL('../fixtures/cn-private-key.pem', import.meta.url),
                port: 44300,
            },
            expected: "tcps://test.example.com:44300",
        },
        {
            args: {
                cert: new URL('../fixtures/cn-public-cert.pem', import.meta.url),
                key: new URL('../fixtures/cn-private-key.pem', import.meta.url),
                port: 4430,
                host: 'example.com:443',
            },
            expected: "tcps://test.example.com:443",
        },
        {
            args: {
                cert: new URL('../fixtures/cn-public-cert.pem', import.meta.url),
                key: new URL('../fixtures/cn-private-key.pem', import.meta.url),
                port: 4430,
                host: 'tcp://example.com:443',
            },
            expected: "tcps://test.example.com:443",
        },
    ];

    urlTests.forEach(({args, expected}) => {
        it(`getIngress() for ${JSON.stringify(args)} returns ${expected}`, async () => {
            const tunnel = new Tunnel();
            tunnel.id = 'test';

            const ingress = new SNIIngress(args);
            const ing = ingress.getIngress(tunnel);
            await ingress.destroy();

            assert(ing.url == expected, `got ${ing.url}`);
            return true;
        });
    });
});