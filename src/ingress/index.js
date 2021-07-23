import assert from 'assert/strict';
import HttpIngress from './http-ingress.js';
import SNIIngress from './sni-ingress.js';

class Ingress {
    constructor(opts) {
        if (Ingress.instance !== undefined) {
            return Ingress.instance;
        }
        Ingress.instance = this;
        assert(opts != undefined);
        this.opts = opts;
        this.ingress = {};

        const p = [];

        if (opts.http?.enabled == true) {
            p.push(new Promise((resolve) => {
                this.ingress.http = new HttpIngress({
                    ...opts.http,
                    callback: resolve,
                });
            }));
        }

        if (opts.sni?.enabled == true) {
            p.push(new Promise((resolve) => {
                this.ingress.sni = new SNIIngress({
                    ...opts.sni,
                    callback: resolve
                });
            }));
        }

        setImmediate(async () => {
            await Promise.allSettled(p);
            typeof opts.callback === 'function' && opts.callback();
        });
    }

    async destroy() {
        return Promise.allSettled(
            Object.keys(this.ingress).map(k => this.ingress[k].destroy())
        );
    }

    getIngress(tunnel) {
        const ingress = {};

        if (this.opts?.http?.enabled == true) {
            ingress.http = {
                ...tunnel.ingress.http,
                ...this.ingress.http.getIngress(tunnel),
            }
        }

        if (this.opts?.sni?.enabled == true) {
            ingress.sni = {
                ...tunnel.ingress.sni,
                ...this.ingress.sni.getIngress(tunnel),
            }
        }

        return ingress;
    }
}

export default Ingress;