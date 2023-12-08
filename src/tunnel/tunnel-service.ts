import crypto from 'node:crypto';
import EventBus, { EmitMeta } from "../cluster/eventbus.js";
import ClusterService from "../cluster/index.js";
import { Logger } from "../logger.js";
import Storage from "../storage/index.js";
import { TunnelConfig, TunnelHttpIngressConfig, TunnelIngressConfig, TunnelIngressTypeConfig, cloneTunnelConfig  } from "./tunnel-config.js";
import { Tunnel, TunnelConnection } from "./tunnel.js";
import Account from '../account/account.js';
import { difference, safeEqual, symDifference } from '../utils/misc.js';
import Transport from '../transport/transport.js';
import Node from '../cluster/cluster-node.js';
import { IngressType } from '../ingress/ingress-manager.js';
import AltNameService from './altname-service.js';
import CustomError, { ERROR_TUNNEL_INGRESS_BAD_ALT_NAMES } from '../utils/errors.js';
import IngressService from '../ingress/ingress-service.js';
import TunnelConnectionManager, { TunnelAnnounce, TunnelDisconnectRequest } from './tunnel-connection-manager.js';
import AccountTunnelService from '../account/account-tunnel-service.js';

export type ConnectOptions = {
    peer: string,
}

type AuthorizeResult = {
    authorized: boolean,
    disabled: boolean,
    tunnel?: Tunnel,
    account?: Account,
    error?: Error,
};

type TunnelListResult = {
    cursor: string | null,
    tunnels: Array<Tunnel>,
};

export default class TunnelService {

    static TUNNEL_ID_REGEX = /^(?:[a-z0-9][a-z0-9\-]{4,63}[a-z0-9]|[a-z0-9]{4,63})$/;

    static instance?: TunnelService;
    static ref: number;

    private destroyed: boolean = false;
    private logger: any;
    private storage!: Storage;
    private ingressService!: IngressService;
    private eventBus!: EventBus;
    private clusterService!: ClusterService;
    private altNameService!: AltNameService;
    private accountTunnelService!: AccountTunnelService;

    constructor() {
        if (TunnelService.instance instanceof TunnelService) {
            TunnelService.ref++;
            return TunnelService.instance;
        }
        TunnelService.ref = 1;
        TunnelService.instance = this;

        this.logger = Logger("tunnel-service");
        this.storage = new Storage("tunnel");
        this.ingressService = new IngressService();
        this.eventBus = new EventBus();
        this.clusterService = new ClusterService();
        this.altNameService = new AltNameService();
        this.accountTunnelService = new AccountTunnelService();
    }

    public async destroy(): Promise<void> {
        if (this.destroyed) {
            return;
        }

        if (--TunnelService.ref == 0) {
            this.destroyed = true
            await Promise.allSettled([
                this.storage.destroy(),
                this.eventBus.destroy(),
                this.clusterService.destroy(),
                this.ingressService.destroy(),
                this.altNameService.destroy(),
                this.accountTunnelService.destroy(),
            ]);
            TunnelService.instance = undefined;
        }
    }

    private async _get(tunnelId: string): Promise<Tunnel>;
    private async _get(tunnelIds: Array<string>): Promise<Array<Tunnel>>;
    private async _get(tunnelIds: any): Promise<any> {
        const tunnelConfig = await this.storage.read(tunnelIds, TunnelConfig);
        if (tunnelConfig instanceof Array) {
            return tunnelConfig.map((tc: TunnelConfig) => {
                const state = TunnelConnectionManager.getConnectedState(tc.id);
                return new Tunnel(tc, state);
            });

        } else if (tunnelConfig instanceof TunnelConfig) {
            const state = TunnelConnectionManager.getConnectedState(tunnelConfig.id);
            return new Tunnel(tunnelConfig, state);
        } else {
            if (tunnelIds instanceof Array) {
                return [];
            } else {
                throw Error('no_such_tunnel');
            }
        }
    }

    private _isPermitted(tunnel: Tunnel, accountId: string): boolean {
        return accountId != undefined && accountId === tunnel.config.account;
    }

    public async create(tunnelId: string, accountId: string): Promise<Tunnel> {
        const tunnelConfig = new TunnelConfig(tunnelId, accountId);
        tunnelConfig.created_at = new Date().toISOString();
        tunnelConfig.updated_at = tunnelConfig.created_at;
        tunnelConfig.transport.token = crypto.randomBytes(64).toString('base64url');

        const created: boolean = await this.storage.create(tunnelId, tunnelConfig);
        if (!created) {
            throw Error("could_not_create_tunnel");
        }

        const assigned = await this.accountTunnelService.assignTunnel(tunnelConfig);
        if (!assigned) {
            await this.storage.delete(tunnelId);
            throw Error("could_not_create_tunnel");
        }

        this.logger
            .withContext('tunnel', tunnelId)
            .debug({
                message: `tunnel ${tunnelId} created`,
                operation: 'create_tunnel',
            });

        return this._get(tunnelId);
    }

    public async delete(tunnelId: string, accountId: string): Promise<boolean> {
        const tunnel = await this._get(tunnelId);
        if (!this._isPermitted(tunnel, accountId)) {
            throw Error("permission_denied")
        }

        //TODO disable tunnel
        try {
            const disconnected = await this.disconnect(tunnelId, accountId);
            if (!disconnected) {
                this.logger
                    .withContext('tunnel', tunnelId)
                    .warn({
                        message: `tunnel not disconnected, deleting anyway`,
                        operation: 'delete_tunnel',
                    });
            }
        } catch (e: any) {
            this.logger
                .withContext('tunnel', tunnelId)
                .error({
                    message: `failed to disconnect tunnel: ${e.message}`,
                    operation: 'delete_tunnel',
                    stack: `${e.stack}`,
                });
        }

        try {
            await Promise.all([
                this.altNameService.update(
                    'http',
                    tunnel.config.id,
                    [],
                    tunnel.config.ingress.http.alt_names,
                ),
                this.storage.delete(<any>tunnelId),
                this.accountTunnelService.unassignTunnel(tunnel.config)
            ]);
        } catch (e: any) {
            this.logger
                .withContext('tunnel', tunnelId)
                .error({
                    message: `failed to delete tunnel: ${e.message}`,
                    operation: 'delete_tunnel',
                    stack: `${e.stack}`,
                });
            return false;
        }
        this.logger
            .withContext('tunnel', tunnelId)
            .debug({
                message: `tunnel ${tunnelId} deleted`,
                operation: 'delete_tunnel',
            });
        return true;
    }

    private async updateIngressConfig(tunnelConfig: TunnelConfig, prevTunnelConfig: TunnelConfig): Promise<TunnelIngressConfig> {

        const updateHttp = async (): Promise<TunnelHttpIngressConfig> =>  {
            if (!this.ingressService.enabled(IngressType.INGRESS_HTTP)) {
                return {
                    enabled: false,
                    url: undefined,
                    urls: [],
                    alt_names: [],
                }
            }

            const baseUrl = this.ingressService.getIngressURL(IngressType.INGRESS_HTTP, tunnelConfig.id);

            let altNames = tunnelConfig.ingress.http.alt_names || [];
            const prevAltNames = prevTunnelConfig.ingress.http.alt_names || [];
            if (symDifference(altNames, prevAltNames).length != 0) {
                const resolvedAltNames = await AltNameService.resolve(baseUrl.hostname, altNames);
                const diff = symDifference(resolvedAltNames, altNames);
                if (diff.length > 0) {
                    throw new CustomError(ERROR_TUNNEL_INGRESS_BAD_ALT_NAMES, diff.join(', '));
                }

                const updatedAltNames = await this.altNameService.update(
                    'http',
                    tunnelConfig.id,
                    difference(resolvedAltNames, prevAltNames),
                    difference(prevAltNames, resolvedAltNames)
                );
                altNames = updatedAltNames;
            }

            const altUrls = altNames.map((an) => {
                const url = new URL(baseUrl);
                url.hostname = an;
                return url.href;
            });

            if (tunnelConfig.ingress.http.enabled) {
                return {
                    enabled: true,
                    url: baseUrl.href,
                    urls: [
                        baseUrl.href,
                        ...altUrls,
                    ],
                    alt_names: altNames
                }
            } else {
                return {
                    enabled: false,
                    url: undefined,
                    urls: [],
                    alt_names: altNames
                }
            }
        }

        const updateSni = async (): Promise<TunnelIngressTypeConfig> =>  {
            if (!this.ingressService.enabled(IngressType.INGRESS_SNI) || !tunnelConfig.ingress.sni.enabled) {
                return {
                    enabled: false,
                    url: undefined,
                    urls: [],
                }
            }

            const baseUrl = this.ingressService.getIngressURL(IngressType.INGRESS_SNI, tunnelConfig.id);
            return {
                enabled: true,
                url: baseUrl.href,
                urls: [
                    baseUrl.href
                ],
            }
        }

        return {
            http: await updateHttp(),
            sni: await updateSni(),
        }
    }

    public async update(tunnelId: string, accountId: string, callback: (tunnelConfig: TunnelConfig) => void): Promise<Tunnel> {
        let tunnel = await this._get(tunnelId);
        if (!this._isPermitted(tunnel, accountId)) {
            throw new Error('permission_denied');
        }

        const updatedConfig = await this.storage.update(tunnelId, TunnelConfig, async (tunnelConfig: TunnelConfig) => {

            const origConfig = cloneTunnelConfig(tunnelConfig);
            callback(tunnelConfig);

            let ingressConfig;

            ingressConfig = await this.updateIngressConfig(tunnelConfig, origConfig);

            if (tunnelConfig.ingress.http.enabled && !ingressConfig.http.enabled) {
                throw new Error('ingress_administratively_disabled');
            } else if (tunnelConfig.ingress.sni.enabled && !ingressConfig.sni.enabled) {
                throw new Error('ingress_administratively_disabled');
            }

            tunnelConfig.ingress = ingressConfig;
            tunnelConfig.updated_at = new Date().toISOString();

            return true;
        });

        tunnel.config = updatedConfig;
        return tunnel;
    }

    public async list(cursor: string | undefined, count: number = 10, verbose: boolean = false): Promise<TunnelListResult> {
        const res = await this.storage.list(<any>cursor, count);

        const data: Array<Tunnel> = verbose ? await this._get(res.data) : res.data.map((id: string) => {
            return new Tunnel(new TunnelConfig(id, <any>undefined), undefined)
        });
        return {
            cursor: res.cursor,
            tunnels: data,
        }
    }

    public async get(tunnelId: string, accountId: string): Promise<Tunnel> {
        const tunnel = await this._get(tunnelId);
        if (!this._isPermitted(tunnel, accountId)) {
            throw Error("permission_denied")
        }
        return tunnel;
    }

    public async lookup(tunnelId: string): Promise<Tunnel> {
        return this._get(tunnelId);
    }

    public async authorize(tunnelId: string, token: string): Promise<AuthorizeResult> {
        const result: AuthorizeResult = {
            authorized: false,
            disabled: false,
            tunnel: undefined,
            account: undefined,
            error: undefined,
        };

        try {
            const tunnel = await this._get(tunnelId);
            const account = await this.accountTunnelService.authorizedAccount(tunnel);
            const correctToken = tunnel.config.transport.token != undefined &&
                safeEqual(token, tunnel.config.transport.token)

            result.authorized = correctToken && !account.status.disabled;
            if (result.authorized) {
                result.tunnel = tunnel;
                result.account = account;
                result.disabled = account.status.disabled;
            }
        } catch (e: any) {
            result.error = e;
        }

        return result;
    }

    public async connect(tunnelId: string, accountId: string, transport: Transport, opts: ConnectOptions): Promise<boolean> {
        if (!TunnelConnectionManager.ready) {
            return false;
        }

        let tunnel = await this._get(tunnelId);
        if (!this._isPermitted(tunnel, accountId)) {
            return false;
        }

        if (tunnel.state.alive_connections >= transport.max_connections) {
            this.logger
                .withContext('tunnel',tunnelId)
                .info({
                    message: `Refused transport connection, current connections ${tunnel.state.connections.length}, max connections ${transport.max_connections}`,
                    operation: 'connect_tunnel',
                    connections: tunnel.state.alive_connections,
                    max_connections: transport.max_connections,
                });
            return false;
        }

        const connection: TunnelConnection = {
            connection_id: `${Node.identifier}:${crypto.randomUUID()}`,
            transport,
            node: Node.identifier,
            peer: opts.peer,
            local: true,
            connected: true,
            connected_at: Date.now(),
            alive_at: Date.now(),
        };

        await TunnelConnectionManager.addTunnelConnection(tunnel, connection);
        transport.once('close', () => {
            TunnelConnectionManager.removeTunnelConnection(tunnelId, connection.connection_id);
        });

        tunnel = await this.update(tunnelId, accountId, (tunnelConfig) => {
            tunnelConfig.transport.token = crypto.randomBytes(64).toString('base64url');
        });

        this.logger
            .withContext('tunnel',tunnelId)
            .debug({
                message: `Tunnel transport connected, peer ${opts.peer}`,
                operation: 'connect_tunnel',
                connections: tunnel.state.alive_connections,
                max_connections: transport.max_connections,
            });
        return true;
    }

    public async disconnect(tunnelId: string, accountId: string): Promise<boolean> {
        let tunnel = await this._get(tunnelId);
        if (!this._isPermitted(tunnel, accountId)) {
            return false;
        }

        const alive_connections = tunnel.state.connections
            .filter((con) => con.connected);

        const announces = alive_connections.map((con) => {
            return this.eventBus.waitFor('tunnel:announce', (announces: Array<TunnelAnnounce>, meta: EmitMeta) => {
                return announces.filter((announce) => announce.tunnel_id == tunnelId).length > 0
            }, 500);
        });

        const tunnelDisconnect: TunnelDisconnectRequest = {
            tunnel_id: tunnelId
        };
        this.eventBus.publish('tunnel:disconnect', tunnelDisconnect);

        const res = await Promise.allSettled(announces);
        tunnel = await this._get(tunnelId);

        this.logger
            .withContext('tunnel',tunnelId)
            .debug({
                message: `Tunnel disconnection result, disconnected=${!tunnel.state.connected}`,
                operation: 'disconnect_tunnel',
                connections: tunnel.state.alive_connections,
            });

        return !tunnel.state.connected;
    }
}
