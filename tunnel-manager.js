import hri from 'human-readable-ids';
import WebSocketTunnel from './tunnel/ws-tunnel.js';

class TunnelManager {
    constructor(opts) {
        this.opts = opts;
        this.activeTunnels = {};

        this.config = {};
        this._get = async (key) => {
            return this.config[key];
        };

        this._set = async (key, data, opts = {}) => {
            if (opts.NX === true && this.config[key] !== undefined) {
                return false;
            }
            this.config[key] = data;
            return this.config[key];
        };

        this._delete = async (key) => {
            delete this.config[key];
        };
    }

    _activateTunnels(tunnel) {
        if (this.activeTunnels[tunnel.id]) {
            return this.activeTunnels[tunnel.id];
        }
        const activeTunnels = this.activeTunnels[tunnel.id] = {};
        activeTunnels['websocket'] = new WebSocketTunnel(tunnel.id, this.opts.subdomainUrl);
        return activeTunnels;
    }

    _getTunnels(tunnel) {
        const tunnels = this._activateTunnels(tunnel);
        return {
            ...tunnel,
            tunnels
        };
    }

    _newTunnel(tunnelId) {
        const url = new URL(this.opts.subdomainUrl.href);
        url.hostname = `${tunnelId}.${url.hostname}`;
        const ingress = url.href;
        return {
            id: tunnelId,
            ingress,
        };
    }

    async get(tunnelId) {
        const tunnel = await this._get(tunnelId);
        if (tunnel === undefined) {
            return false;
        }
        return this._getTunnels(tunnel);
    }

    async _allocateRandomTunnel() {
        let tunnelId;
        let tunnel;
        do {
            tunnelId = hri.hri.random();
            tunnel = await this._set(tunnelId, this._newTunnel(tunnelId), {NX: true});
        } while (tunnel === false);
        return tunnel;
    }

    async create(tunnelId, opts = {}) {
        let tunnel;
        if (tunnelId == undefined) {
            tunnel = await this._allocateRandomTunnel();
        } else {
            tunnel = await this._set(tunnelId, this._newTunnel(tunnelId), {NX: true});
            if (tunnel === false && opts.allowExists) {
                tunnel = await this._get(tunnelId);
            }
        }

        if (tunnel === false) {
            return false;
        }
        return this._getTunnels(tunnel);
    }

    delete(id) {
    }

}

export default TunnelManager;