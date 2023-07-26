import assert from 'assert/strict';
import AltNameService from './altname-service.js';
import { ERROR_TUNNEL_INGRESS_BAD_ALT_NAMES } from '../utils/errors.js';
import { difference, symDifference } from '../utils/misc.js';
import HttpIngress from './http-ingress.js';
import SNIIngress from './sni-ingress.js';
import TunnelService from '../tunnel/tunnel-service.js';

class Ingress {
    constructor(opts) {
        if (Ingress.instance instanceof Ingress) {
            Ingress.ref++;
            return Ingress.instance;
        }
        // There is a circular dependency between Ingress and TunnelService, we set the initial
        // reference to 0, as it will be increased to 1 when creating the TunnelService instance.
        Ingress.ref = 0;
        Ingress.instance = this;

        assert(opts != undefined);
        this.opts = opts;
        this._tunnelService = new TunnelService();
        this.ingress = {};

        const p = [];

        if (opts.http?.enabled == true) {
            p.push(new Promise((resolve, reject) => {
                this.ingress.http = new HttpIngress({
                    tunnelService: this._tunnelService,
                    ...opts.http,
                    callback: (e) => {
                        e ? reject(e) : resolve()
                    },
                });
            }));
        }

        if (opts.sni?.enabled == true) {
            p.push(new Promise((resolve, reject) => {
                this.ingress.sni = new SNIIngress({
                    tunnelService: this._tunnelService,
                    ...opts.sni,
                    callback: (e) => {
                        e ? reject(e) : resolve()
                    },
                });
            }));
        }

        this.altNameService = new AltNameService();

        Promise.all(p).then(() => {
            typeof opts.callback === 'function' && opts.callback();
        }).catch(e => {
            typeof opts.callback === 'function' && opts.callback(e);
        });
    }

    async destroy() {
        if (--Ingress.ref == 0) {
            this.destroyed = true;
            const promises = Object.keys(this.ingress)
                .map(k => this.ingress[k].destroy())
                .concat([this.altNameService.destroy()]);
            const res = await Promise.allSettled(promises);
            await this._tunnelService.destroy();
            delete Ingress.instance;
        }
    }

    async updateIngress(tunnel, prevTunnel) {
        const error = (code, values) => {
            const err = new Error(code);
            err.code = code;
            err.details = values;
            return err;
        };

        const update = async (ing) => {
            const obj = {
                ...tunnel.ingress[ing],
            };

            const prevAltNames = prevTunnel.ingress[ing]?.alt_names || [];
            const baseUrl = this.ingress[ing].getBaseUrl(tunnel.id);
            const altNames = obj?.alt_names || [];
            if (symDifference(altNames, prevAltNames).length != 0) {
                const resolvedAltNames = await AltNameService.resolve(baseUrl.hostname, altNames);
                const diff = symDifference(resolvedAltNames, altNames);
                if (diff.length > 0) {
                    return error(ERROR_TUNNEL_INGRESS_BAD_ALT_NAMES, diff);
                }

                obj.alt_names = await this.altNameService.update(
                    ing,
                    tunnel.id,
                    difference(resolvedAltNames, prevAltNames),
                    difference(prevAltNames, resolvedAltNames)
                );
            }

            return {
                ...obj,
                ...this.ingress[ing].getIngress(tunnel, obj.alt_names),
            }
        };

        const ingress = {};
        for (const ing of Object.keys(this.ingress)) {
            const res = await update(ing);
            if (res instanceof Error) {
                return res;
            }
            ingress[ing] = res;
        }

        return ingress;
    }

    async deleteIngress(tunnel) {
        for (const ing of ['http', 'sni']) {
            await this.altNameService.update(
                ing,
                tunnel.id,
                [],
                tunnel.ingress[ing].alt_names,
            );
            tunnel.ingress[ing].alt_names = [];
        }
    }
}

export default Ingress;