import TunnelService from '../tunnel/tunnel-service.js';

class Account {

    static ACCOUNT_ID_ALPHABET = 'CDEFHJKMNPRTVWXY2345689';
    static ACCOUNT_ID_LENGTH = 16;
    static ACCOUNT_ID_REGEX = new RegExp(`^[${Account.ACCOUNT_ID_ALPHABET}]{${Account.ACCOUNT_ID_LENGTH}}$`);

    static generateId() {
        return [...Array(Account.ACCOUNT_ID_LENGTH)].map(() => Account.ACCOUNT_ID_ALPHABET[Math.floor(Math.random() * Account.ACCOUNT_ID_ALPHABET.length)]).join('');
    }

    static normalizeId(accountId) {
        const normalized = accountId.replace(/ /g, '').toUpperCase();
        if (Account.ACCOUNT_ID_REGEX.test(normalized)) {
            return normalized;
        } else {
            return undefined;
        }
    }

    static formatId(accountId) {
        return accountId.replace(/.{1,4}(?=(.{4})+$)/g, '$& ');
    }

    constructor(accountId) {
        if (accountId) {
            const normalized = Account.normalizeId(accountId);
            if (normalized === undefined) {
                throw new Error(`invalid account id ${accountId}`);
            }
            accountId = normalized;
        }
        this.accountId = accountId || Account.generateId();

        this._tunnelService = new TunnelService();
    }

    getId() {
        return {
            accountId: this.accountId,
            formatted: Account.formatId(this.accountId),
        }
    }

    async getTunnel(tunnelId) {
        return await this._tunnelService.get(tunnelId, this.accountId);
    }

    async createTunnel(tunnelId) {
        return await this._tunnelService.create(tunnelId, this.accountId);
    }

    async updateTunnel(tunnelId, cb) {
        return await this._tunnelService.update(tunnelId, this.accountId, cb);
    }

    async deleteTunnel(tunnelId) {
        return await this._tunnelService.delete(tunnelId, this.accountId);
    }

    async disconnectTunnel(tunnelId) {
        return await this._tunnelService.disconnect(tunnelId, this.accountId);
    }

}

export default Account;