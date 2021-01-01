import crypto from 'crypto';
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

    _newTunnel(tunnelId) {
        const url = new URL(this.opts.subdomainUrl.href);
        url.hostname = `${tunnelId}.${url.hostname}`;
        const ingress = url.href;
        const authToken = crypto.randomBytes(64).toString('base64');
        return {
            id: tunnelId,
            authToken,
            ingress,
        };
    }

    activate(tunnel) {
        const tunnelId = tunnel.id;
        if (this.activeTunnels[tunnelId]) {
            return this.activeTunnels[tunnelId];
        }
        const activeTunnels = this.activeTunnels[tunnelId] = {};
        activeTunnels['websocket'] = new WebSocketTunnel(tunnel, this.opts.subdomainUrl);
        return activeTunnels;
    }

    deactivate(tunnelId) {
        if (!this.activeTunnels[tunnelId]) {
            return;
        }
        const activeTunnels = this.activeTunnels[tunnelId];
        activeTunnels['websocket'].shutdown();
        delete this.activeTunnels[tunnelId];
    }

    _getActiveTunnels(tunnel) {
        const tunnels = this.activate(tunnel);
        return {
            ...tunnel,
            tunnels
        };
    }

    async get(tunnelId) {
        const tunnel = await this._get(tunnelId);
        if (tunnel === undefined) {
            return false;
        }
        return this._getActiveTunnels(tunnel);
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
        return this._getActiveTunnels(tunnel);
    }

    shutdown() {
        Object.keys(this.activeTunnels).forEach((tunnelId) => {
            this.deactivate(tunnelId);
        });
    }

}

export default TunnelManager;