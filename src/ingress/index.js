import HttpIngress from './http-ingress.js';
import assert from 'assert/strict';

class Ingress {
    constructor(opts) {
        if (Ingress.instance !== undefined) {
            return Ingress.instance;
        }
        Ingress.instance = this;
        assert(opts != undefined);
        this.opts = opts;

        const readyCallback = () => {
            typeof opts.callback === 'function' && opts.callback();
        };

        this.ingress = {};
        if (opts.http && opts.http.enabled == true) {
            this.ingress.http = new HttpIngress({
                ...opts.http,
                callback: readyCallback,
            });
        }
    }

    async destroy() {
        this.ingress.http && await this.ingress.http.destroy();
    }

    getIngress(tunnel) {
        const ingress = {};

        const tunnelId = (typeof tunnel === 'string') ? tunnel : tunnel.id;

        if (this.opts.http && this.opts.http.enabled == true) {
            const url = new URL(this.opts.http.subdomainUrl.href);
            url.hostname = `${tunnelId}.${url.hostname}`;
            ingress.http = {
                url: url.href
            }
        }

        return ingress;
    }
}

export default Ingress;