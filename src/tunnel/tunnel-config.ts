import { Serializable } from "../storage/serializer.js";

type TunnelTransportConfig = {
    token?: string,
    max_connections: number,
    ws: TunnelTransportTypeConfig,
    ssh: TunnelTransportTypeConfig,
}

type TunnelTransportTypeConfig = {
    enabled: boolean,
}

export type TunnelIngressConfig = {
    http: TunnelHttpIngressConfig,
    sni: TunnelIngressTypeConfig,
}

export type TunnelIngressTypeConfig = {
    enabled: boolean,
    url: string | undefined,
    urls: Array<string>,
}

export type TunnelHttpIngressConfig = TunnelIngressTypeConfig & {
    alt_names: Array<string>,
}

export type TunnelTargetConfig = {
    url: string | undefined
}

export class TunnelConfig implements Serializable {
    public readonly id?: string;
    public readonly account?: string;

    public transport: TunnelTransportConfig = {
        token: undefined,
        max_connections: 1,
        ws: {
            enabled: false
        },
        ssh: {
            enabled: false
        }
    }

    public ingress: TunnelIngressConfig = {
        http: {
            enabled: false,
            url: undefined,
            urls: [],
            alt_names: [],
        },
        sni: {
            enabled: false,
            url: undefined,
            urls: [],
        }
    }

    public target: TunnelTargetConfig = {
        url: undefined
    }

    public created_at?: string;
    public updated_at?: string;

    constructor(tunnelId?: string, account?: string) {
        this.id = tunnelId;
        this.account = account;
    }
}

export function cloneTunnelConfig(tunnelConfig: TunnelConfig): TunnelConfig {
    const stringify = (object: any) => JSON.stringify(object, (key, value) => {
        if (key[0] == '_') {
            return undefined;
        }
        return value;
    });

    return Object.assign(new TunnelConfig(tunnelConfig.id, tunnelConfig.account), JSON.parse(stringify(tunnelConfig)));
}