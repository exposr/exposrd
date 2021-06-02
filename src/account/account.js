import TunnelService from '../tunnel/tunnel-service.js';
import AccountService from '../account/account-service.js';

class Account {

    constructor(accountId) {
        this.accountId = accountId;
        this.id = accountId;
        this.created_at = undefined;
        this.updated_at = undefined;
        this.tunnels = [];

        this._tunnelService = new TunnelService();
    }

    _deserialization_hook() {
        this.id ??= this.accountId;
        delete this.accountId;
        this.created_at ??= new Date().toISOString();
        this.updated_at ??= new Date().toISOString();
    }

    getId() {
        return {
            accountId: this.id,
            formatted: AccountService.formatId(this.id),
        }
    }

    async getTunnel(tunnelId) {
        return await this._tunnelService.get(tunnelId, this.id);
    }

    async createTunnel(tunnelId) {
        return await this._tunnelService.create(tunnelId, this.id);
    }

    async updateTunnel(tunnelId, cb) {
        return await this._tunnelService.update(tunnelId, this.id, cb);
    }

    async deleteTunnel(tunnelId) {
        return await this._tunnelService.delete(tunnelId, this.id);
    }

    async disconnectTunnel(tunnelId) {
        return await this._tunnelService.disconnect(tunnelId, this.id);
    }

}

export default Account;