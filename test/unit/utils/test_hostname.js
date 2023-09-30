import Hostname from '../../../src/utils/hostname.js';
import assert from 'assert/strict';

describe('hostname', () => {

    const parseTests = [
        {args: ['example.com', 80], expected: new URL("http://example.com/")},
        {args: ['example.com', 0], expected: new URL("tcp://example.com")},
        {args: ['example.example', "0"], expected: new URL("tcp://example.example")},
        {args: ['localhost', 0], expected: new URL("tcp://localhost")},
        {args: ['example.com:80'], expected: new URL("http://example.com/")},
        {args: ['http://example.com:80'], expected: new URL("http://example.com/")},
        {args: ['http://example.com'], expected: new URL("http://example.com/")},
        {args: ['example.com', 443], expected: new URL("https://example.com/")},
        {args: ['http://example.com:443'], expected: new URL("http://example.com:443/")},
        {args: ['ssh://example.com:2200'], expected: new URL("ssh://example.com:2200")},
        {args: ['example.com', 65536], expected: undefined},
    ];

    parseTests.forEach(({args, expected}) => {
        it(`parse() correctly parses ${args}`, () => {
            const url = Hostname.parse(...args)
            assert(url?.href == expected?.href, `got ${url?.href}`);
        });
    });

    const tlsTests = [
        {url: new URL("https://example.com"), expected: true},
        {url: new URL("wss://example.com"), expected: true},
        {url: new URL("tcps://example.com"), expected: true},
        {url: new URL("tcp://example.com"), expected: false},
        {url: new URL("ssh://example.com"), expected: false},
        {url: new URL("http://example.com"), expected: false},
        {url: new URL("ws://example.com"), expected: false},
    ]

    tlsTests.forEach(({url, expected}) => {
        it(`isTLS(): ${url.protocol} is TLS ${expected}`, () => {
            const result = Hostname.isTLS(url)
            assert(result == expected, `got ${result}`);
        });
    });

    const portTests = [
        {url: new URL("https://example.com"), expected: 443},
        {url: new URL("wss://example.com"), expected: 443},
        {url: new URL("ssh://example.com:2200"), expected: 2200},
        {url: new URL("http://example.com"), expected: 80},
        {url: new URL("ws://example.com"), expected: 80},
        {url: new URL("tcp://example.com:1234"), expected: 1234},
    ]

    portTests.forEach(({url, expected}) => {
        it(`getPort(): ${url.href} is ${expected}`, () => {
            const result = Hostname.getPort(url)
            assert(result == expected, `got ${result}`);
        });
    });
});