import Storage from '../storage/index.js';
import Tunnel from './tunnel.js';
import { Logger } from '../logger.js'; const logger = Logger("tunnel-manager");

class TunnelManager {
    constructor() {
        if (TunnelManager.instance !== undefined) {
            return TunnelManager.instance
        }
        this.activeTunnels = {};
        this.db = new Storage("tunnel");
        TunnelManager.instance = this;
    }

    async get(tunnelId) {
        if (this.activeTunnels[tunnelId]) {
            return this.activeTunnels[tunnelId];
        }

        const tunnelSpec = await this.db.get(tunnelId);
        if (tunnelSpec === undefined) {
            return false;
        }
        const tunnel = new Tunnel(tunnelId, tunnelSpec);
        this.activeTunnels[tunnelId] = tunnel;
        logger.isDebugEnabled() && logger.debug(`get tunnel=${tunnelId}`);
        return tunnel;
    }

    async create(tunnelId, tunnelSpec, opts) {
        const created = await this.db.set(tunnelId, {}, {NX: true});
        if (created === false && opts.allowExists === false) {
            return false;
        }

        if (this.activeTunnels[tunnelId] !== undefined) {
            const tunnel = this.activeTunnels[tunnelId];
            tunnel.setSpec(tunnelSpec);
            return tunnel;
        }

        logger.isDebugEnabled() && logger.debug(`created tunnel=${tunnelId}`);

        const tunnel = new Tunnel(tunnelId, tunnelSpec);
        this.activeTunnels[tunnelId] = tunnel;
        return tunnel;

    }

    async delete(tunnelId) {
        if (this.activeTunnels[tunnelId] === undefined) {
            return false;
        }
        const tunnel = this.activeTunnels[tunnelId];
        await tunnel.delete();
        delete this.activeTunnels[tunnelId];
        logger.isDebugEnabled() && logger.debug(`deleted tunnel=${tunnelId}`);
        return true;
    }
}

export default TunnelManager;