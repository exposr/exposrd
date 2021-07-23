import SNIIngress from '../../src/ingress/sni-ingress.js';
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

    it("construct instance with valid certificates", (done) => {
        const sni = new SNIIngress({
            cert: new URL('../fixtures/cn-public-cert.pem', import.meta.url),
            key: new URL('../fixtures/cn-private-key.pem', import.meta.url),
        });
        done();
    });
});