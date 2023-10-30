import HttpIngress, { HttpIngressOptions } from './http-ingress.js';
import SNIIngress, { SniIngressOptions } from './sni-ingress.js';
import IngressBase from './ingress-base.js';

export type IngressOptions = {
    http?: {
        enabled: boolean,
     } & HttpIngressOptions,
    sni?: {
        enabled: boolean,
    } & SniIngressOptions,
}

export enum IngressType {
    INGRESS_HTTP = 'http',
    INGRESS_SNI = 'sni',
}

class IngressManager {
    public static listening: boolean = false;

    private static ingress: {
        [ key in IngressType ]: {
            enabled: boolean,
            instance?: IngressBase,
        }
    }

    public static async listen(opts: IngressOptions): Promise<boolean> {
        if (this.listening) {
            return true;
        }

        this.ingress = {
            http: {
                enabled: opts.http?.enabled || false,
            },
            sni: {
                enabled: opts.sni?.enabled || false,
            },
        };

        const p = [];

        if (this.ingress.http.enabled == true) {
            p.push(new Promise((resolve, reject) => {
                this.ingress.http.instance = new HttpIngress({
                    ...<HttpIngressOptions>opts.http,
                    callback: (e?: Error) => {
                        e ? reject(e) : resolve(undefined)
                    },
                });
            }));
        }

        if (this.ingress.sni.enabled == true) {
            p.push(new Promise((resolve, reject) => {
                this.ingress.sni.instance = new SNIIngress({
                    ...<SniIngressOptions>opts.sni,
                    callback: (e?: Error) => {
                        e ? reject(e) : resolve(undefined)
                    },
                });
            }));
        }

        const res = await Promise.all(p).then(() => {
            return true;
        }).catch(async (e) => {
            await this.close();
            throw e;
        });
        return res;
    }

    public static async close(): Promise<void> {
        await Promise.allSettled([
            this.ingress.http.instance?.destroy(),
            this.ingress.sni.instance?.destroy(),
        ]);
        this.ingress = {
            http: {
                enabled: false,
            },
            sni: {
                enabled: false,
            },
        };
        this.listening = false;
    }

    public static getIngress(ingressType: IngressType): IngressBase {
        return <IngressBase>this.ingress[ingressType].instance;
    }

    public static ingressEnabled(ingressType: IngressType): boolean {
        return this.ingress[ingressType].enabled;
    }
}

export default IngressManager;