import IngressManager, { IngressType } from "./ingress-manager.js";

export default class IngressService {

    static instance: IngressService | undefined;
    static ref: number;

    private destroyed: boolean = false;

    constructor() {
        if (IngressService.instance instanceof IngressService) {
            IngressService.ref++;
            return IngressService.instance;
        }
    }

    public async destroy(): Promise<void> {
        if (this.destroyed) {
            return;
        }
        if (--IngressService.ref == 0) {
            this.destroyed = true;
            IngressService.instance = undefined;
        }
    }

    public enabled(ingressType: IngressType): boolean {
        return IngressManager.ingressEnabled(ingressType)
    }

    public getIngressURL(ingressType: IngressType, tunnelId: string): URL {
        if (!this.enabled(ingressType)) {
            throw new Error('ingress_administratively_disabled');
        }
        return IngressManager.getIngress(ingressType).getBaseUrl(tunnelId);
    }
}