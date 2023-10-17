import assert from "assert";
import HttpListener, { HttpRequestCallback, HttpRequestType, HttpUpgradeCallback } from "../../../src/listener/http-listener.js";
import Listener from "../../../src/listener/listener.js";
import http from 'http';
import { setTimeout } from "timers/promises";
import { Socket } from "net";

describe('HTTP listener', () => {

    it(`can listen on port`, async () => {
        const httpListener = Listener.acquire(HttpListener, 8080);

        const requestHandler: HttpRequestCallback = async (ctx, next): Promise<void> => {
            ctx.res.statusCode = 201;
            ctx.res.end('foo')
        };

        httpListener.use(HttpRequestType.request, requestHandler);
        assert(httpListener["callbacks"]["request"].length == 1);

        await httpListener.listen()

        let res = await fetch("http://localhost:8080");
        assert(res.status == 201);

        let data = await res.text();
        assert(data == 'foo');

        httpListener.removeHandler(HttpRequestType.request, requestHandler);
        assert(httpListener["callbacks"]["request"].length == <number>0);


        await Listener.release(8080);
        assert(httpListener["_destroyed"] == true);

        try {
            await fetch("http://localhost:8080");
            assert(false, "listener is still listening");
        } catch (e:any) {
            assert(true);
        }
    });

    it(`destroy removes installed handlers`, async () => {
        const httpListener = Listener.acquire(HttpListener, 8080);

        const requestHandler: HttpRequestCallback = async (ctx, next): Promise<void> => {
            ctx.res.statusCode = 201;
            ctx.res.end('foo')
        };

        httpListener.use(HttpRequestType.request, requestHandler);
        await httpListener.listen()

        await httpListener.close()

        await Listener.release(8080);

        assert(httpListener["_destroyed"] == true);
        assert(httpListener["callbacks"]["request"].length == 0, "handler still installed");
    });

    it(`listener can be acquired multiple times`, async () => {
        const httpListener = Listener.acquire(HttpListener, 8080);
        const httpListener2 = Listener.acquire(HttpListener, 8080);
        assert(httpListener == httpListener2)

        const requestHandler: HttpRequestCallback = async (ctx, next): Promise<void> => {
            ctx.res.statusCode = 201;
            ctx.res.end('foo')
        };
        httpListener.use(HttpRequestType.request, requestHandler);
        await httpListener.listen()

        let res = await fetch("http://localhost:8080");
        assert(res.status == 201);
        let data = await res.text();
        assert(data == 'foo');

        const requestHandler2: HttpRequestCallback = async (ctx, next): Promise<void> => {
            ctx.res.statusCode = 200;
            ctx.res.end('bar')
        };
        httpListener2.use(HttpRequestType.request, requestHandler2);
        await httpListener2.listen()

        res = await fetch("http://localhost:8080");
        assert(res.status == 201);
        data = await res.text();
        assert(data == 'foo', `got ${data}`);

        httpListener.removeHandler(HttpRequestType.request, requestHandler);
        await httpListener.close();

        res = await fetch("http://localhost:8080");
        assert(res.status == 200);
        data = await res.text();
        assert(data == 'bar');

        await Listener.release(8080);
        assert(httpListener["_destroyed"] == false);
        await Listener.release(8080);
        assert(httpListener["_destroyed"] == <any>true);
        assert(httpListener["callbacks"]["request"].length == 0, "handler still installed");
    });

    it(`callback can pass request to next handler`, async () => {
        const httpListener = Listener.acquire(HttpListener, 8080);
        const httpListener2 = Listener.acquire(HttpListener, 8080);
        assert(httpListener == httpListener2)

        await Promise.all([httpListener.listen(), httpListener2.listen()]);

        const requestHandler: HttpRequestCallback = async (ctx, next): Promise<void> => {
            next();
        };
        httpListener.use(HttpRequestType.request, requestHandler);

        const requestHandler2: HttpRequestCallback = async (ctx, next): Promise<void> => {
            ctx.res.statusCode = 200;
            ctx.res.end('bar')
        };
        httpListener2.use(HttpRequestType.request, requestHandler2);

        let res = await fetch("http://localhost:8080");
        assert(res.status == 200);
        let data = await res.text();
        assert(data == 'bar');

        await Listener.release(8080);
        assert(httpListener["_destroyed"] == false);
        await Listener.release(8080);
        assert(httpListener["_destroyed"] == <any>true);
    });

    it(`listener on different ports return different instances`, async () => {
        const httpListener = Listener.acquire(HttpListener, 8080);
        const httpListener2 = Listener.acquire(HttpListener, 9090);
        assert(httpListener != httpListener2)

        await Promise.all([httpListener.listen(), httpListener2.listen()]);

        const requestHandler: HttpRequestCallback = async (ctx, next): Promise<void> => {
            ctx.res.statusCode = 201;
            ctx.res.end('foo')
        };
        httpListener.use(HttpRequestType.request, requestHandler);

        const requestHandler2: HttpRequestCallback = async (ctx, next): Promise<void> => {
            ctx.res.statusCode = 200;
            ctx.res.end('bar')
        };
        httpListener2.use(HttpRequestType.request, requestHandler2);

        let res = await fetch("http://localhost:8080");
        assert(res.status == 201);
        let data = await res.text();
        assert(data == 'foo', `got ${data}`);

        httpListener.removeHandler(HttpRequestType.request, requestHandler);
        await httpListener.close();

        res = await fetch("http://localhost:9090");
        assert(res.status == 200);
        data = await res.text();
        assert(data == 'bar');

        await Listener.release(8080);
        await Listener.release(9090);
    });

    it(`callback handlers can be added with different priorities`, async () => {
        const httpListener = Listener.acquire(HttpListener, 8080);
        const httpListener2 = Listener.acquire(HttpListener, 8080);
        assert(httpListener == httpListener2)

        await Promise.all([httpListener.listen(), httpListener2.listen()]);

        const requestHandler: HttpRequestCallback = async (ctx, next): Promise<void> => {
            ctx.res.statusCode = 201;
            ctx.res.end('foo')
        };
        httpListener.use(HttpRequestType.request, requestHandler);

        const requestHandler2: HttpRequestCallback = async (ctx, next): Promise<void> => {
            ctx.res.statusCode = 200;
            ctx.res.end('bar')
        };
        httpListener2.use(HttpRequestType.request, {prio: 1}, requestHandler2);

        let res = await fetch("http://localhost:8080");
        assert(res.status == 200);
        let data = await res.text();
        assert(data == 'bar');

        await Listener.release(8080);
        assert(httpListener["_destroyed"] == false);
        await Listener.release(8080);
        assert(httpListener["_destroyed"] == <any>true);
    });

    it(`can install an upgrade handler`, async () => {
        const httpListener = Listener.acquire(HttpListener, 8080);
        await httpListener.listen();

        const upgradeHandler: HttpUpgradeCallback = async (ctx, next): Promise<void> => {
            ctx.sock.write(`HTTP/${ctx.req.httpVersion} 101 ${http.STATUS_CODES[101]}\r\n`);
            ctx.sock.write('Upgrade: someprotocol\r\n');
            ctx.sock.write('Connection: Upgrade\r\n');
            ctx.sock.write('\r\n');

            ctx.sock.write("upgraded");
            ctx.sock.end();
        };
        httpListener.use(HttpRequestType.upgrade, upgradeHandler);

        const req = http.request({
            hostname: 'localhost',
            port: 8080,
            method: 'GET',
            path: '/',
            headers: {
                "Host": "localhost",
                "Connection": 'Upgrade',
                "Upgrade": 'someprotocol',
                "Origin": `http://localhost`,
            }
        });

        const done = (resolve: (value: any) => void) => {
            req.on('upgrade', (res, socket, head) => {
                resolve(head.toString());
            });
        };
        req.end();

        let data = await new Promise(done);
        assert(data == 'upgraded');

        httpListener.removeHandler(HttpRequestType.upgrade, upgradeHandler);
        await httpListener.close();
        await Listener.release(8080);
    });

    it(`request without a handler returns 500`, async () => {
        const httpListener = Listener.acquire(HttpListener, 8080);
        await httpListener.listen();

        let res = await fetch("http://localhost:8080");
        assert(res.status == 500);

        await httpListener.close();
        await Listener.release(8080);
    });
});