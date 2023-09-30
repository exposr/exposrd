import assert from 'assert/strict';
import { WebSocketEndpoint } from "./ws/index.js"
import { SSHEndpoint } from "./ssh/index.js";
import Tunnel from '../tunnel/tunnel.js';
import { EndpointResult } from './transport-endpoint.js';
import { WebSocketEndpointOptions } from './ws/ws-endpoint.js';
import { SSHEndpointOptions, SSHEndpointResult } from './ssh/ssh-endpoint.js';

type TransportServiceOptions = {
    callback?: (err?: Error | undefined) => void,
    max_connections: number | undefined,
    ws: WebSocketEndpointOptions, 
    ssh: SSHEndpointOptions, 
}

export type TunnelTransports = {
    max_connections: number,
    ws: ({
        enabled: boolean,
    } & EndpointResult) | undefined,
    ssh: {
        enabled: boolean,
    } & SSHEndpointResult | undefined,
}

class TransportService {
    static instance: TransportService | undefined;
    static ref: number;

    private max_connections!: number;
    private transports!: {
        ws: WebSocketEndpoint | undefined,
        ssh: SSHEndpoint | undefined,
    };

    constructor(opts?: TransportServiceOptions) {
        if (TransportService.instance instanceof TransportService) {
            TransportService.ref++;
            return TransportService.instance
        }
        TransportService.ref = 1;
        TransportService.instance = this;

        assert(opts != undefined, "opts is undefined");

        this.transports = {
            ws: undefined,
            ssh: undefined,
        };
        this.max_connections = opts.max_connections || 1;

        const ready = [];
        if (opts.ws && opts.ws.enabled === true) {
            const promise = new Promise((resolve, reject) => {
                this.transports.ws = new WebSocketEndpoint({
                    ...opts.ws,
                    max_connections: this.max_connections,
                    callback: (err?: Error) => err ? reject(err) : resolve(undefined),
                });
            });
            ready.push(promise);
        }

        if (opts?.ssh?.enabled === true) {
            const promise = new Promise((resolve, reject) => {
                this.transports.ssh = new SSHEndpoint({
                    ...opts.ssh,
                    max_connections: this.max_connections,
                    callback: (err?: Error) => err ? reject(err) : resolve(undefined),
                });
            });
            ready.push(promise);
        }

        Promise.all(ready)
            .then(() => {
                typeof opts.callback === 'function' && opts.callback();
            })
            .catch((err) => {
                typeof opts.callback === 'function' && opts.callback(err);
            });
    }

    public async destroy(): Promise<void> {
        if (--TransportService.ref == 0) {
            TransportService.instance = undefined;
            await Promise.allSettled([
                this.transports.ws?.destroy(),
                this.transports.ssh?.destroy()
            ]);
        }
    }

    public getTransports(tunnel: Tunnel, baseUrl: string): TunnelTransports;
    public getTransports(tunnel: Tunnel, baseUrl: URL): TunnelTransports;
    public getTransports(tunnel: Tunnel, baseUrl: any): TunnelTransports {
        let _baseUrl: URL;

        const transports: TunnelTransports = {
            max_connections: this.max_connections,
            ws: undefined,
            ssh: undefined,
        };

        if (typeof baseUrl == "string") {
            try {
                _baseUrl = new URL(baseUrl);
            } catch (e: any) {
                return transports;
            }
        } else {
            _baseUrl = baseUrl;
        }

        if (this.transports.ws instanceof WebSocketEndpoint) {
            transports.ws = {
                enabled: tunnel.config.transport?.ws?.enabled || false, 
                ...this.transports.ws.getEndpoint(tunnel, _baseUrl), 
            }
        }

        if (this.transports.ssh instanceof SSHEndpoint) {
            transports.ssh = {
                enabled: tunnel.config.transport?.ssh?.enabled || false, 
                ...this.transports.ssh.getEndpoint(tunnel, _baseUrl),
            }
        }

        return transports;
    }

}

export default TransportService;
