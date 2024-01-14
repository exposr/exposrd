import { TunnelConfig } from "./tunnel-config.js";
import Transport from "../transport/transport.js";

export type TunnelConnectionNode = string;
export type TunnelConnectionId = string;

export type TunnelConnection = {
    connection_id: TunnelConnectionId,
    node: TunnelConnectionNode, 
    peer: string,
    transport?: Transport,
    local: boolean,
    connected: boolean,
    connected_at?: number,
    disconnected_at?: number,
    alive_at: number,
}

export type TunnelState = {
    connected: boolean,
    connected_at?: number,
    disconnected_at?: number,
    alive_at?: number,
    alive_connections: number,
    connections: Array<TunnelConnection>,
}

export class Tunnel {
    public readonly id?: string;
    public readonly account?: string;
    public config: TunnelConfig;
    public readonly state: TunnelState

    constructor(config?: TunnelConfig, state?: TunnelState) {
        this.id = config?.id;
        this.account = config?.account;
        this.config = config || new TunnelConfig();
        this.state = state || {
            connected: false,
            alive_connections: 0,
            connections: [],
        };
    }
}

export default Tunnel;