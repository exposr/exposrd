import crypto from 'crypto';
import WebSocketTunnel from './tunnel/ws-tunnel.js';
import Storage from './storage/index.js';

class TunnelManager {
    constructor(opts) {
        this.opts = opts;
        this.activeTunnels = {};
        this.db = new Storage("tm");
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
        const tunnel = await this.db.get(tunnelId);
        if (tunnel === undefined) {
            return false;
        }
        return this._getActiveTunnels(tunnel);
    }

    async create(tunnelId, opts = {}) {
        let tunnel = await this.db.set(tunnelId, this._newTunnel(tunnelId), {NX: true});
        if (tunnel === false && opts.allowExists) {
            tunnel = await this.db.get(tunnelId);
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