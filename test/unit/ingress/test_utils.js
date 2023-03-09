import IngressUtils from '../../../src/ingress/utils.js';
import assert from 'assert/strict';

describe('ingress utils', () => {

    const getTunnelIdTests = [
        {args: ['foo.example.com', "example.com"], expected: "foo"},
        {args: ['foo-123.sub-domain.example.com', "sub-domain.example.com"], expected: "foo-123"},
        {args: ['foo.example.com', "*.example.com"], expected: "foo"},
        {args: ['foo.example.com'], expected: "foo"},
    ];

    getTunnelIdTests.forEach(({args, expected}) => {
        it(`getTunnelId() correctly parses ${args}`, () => {
            const tunnelId = IngressUtils.getTunnelId(...args)
            assert(tunnelId == expected, `got ${tunnelId}`);
        });
    });
});