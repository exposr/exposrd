import { URL } from "url";
import Tunnel from "../tunnel/tunnel.js";

export type TransportEndpointOptions = {
    max_connections: number,
}

export interface EndpointResult {
    url: string,
}

export default abstract class TransportEndpoint  {
    public destroyed: boolean = false;
    protected max_connections: number;

    constructor(opts: TransportEndpointOptions) {
        this.max_connections = opts.max_connections
    }

    public abstract getEndpoint(tunnel: Tunnel, baseUrl: URL): EndpointResult;

    protected abstract _destroy(): Promise<void>;

    public async destroy(): Promise<void> {
        if (this.destroyed) {
            return;
        }
        await this._destroy();
        this.destroyed = true;
    }
}