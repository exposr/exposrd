import Storage from '../storage/index.js';
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
        this._accountId = accountId || Account.generateId();
        this._formattedAccountId = Account.formatId(this._accountId);
        this._db = new Storage("account", {
            key: this._accountId,
        });
        this._props = {};
        this.props = new Proxy(this._props, {
            set: (obj, name, value) => {
                process.nextTick(async () => {
                    await self._db.set(this._props);
                });
                return true;
            }
        });

        this.tunnelService = new TunnelService();

        process.nextTick(async () => {
            this._props = await this._db.get()
        });
    }

    getId() {
        return {
            accountId: this._accountId,
            formatted: this._formattedAccountId,
        }
    }

    async getTunnel(tunnelId) {
        return await this.tunnelService.get(tunnelId, this._accountId);
    }

    async createTunnel(tunnelId, props) {
        return await this.tunnelService.create(tunnelId, this._accountId, props, { allowExists: true });
    }

    async deleteTunnel(tunnelId) {
        return await this.tunnelService.delete(tunnelId, this._accountId);
    }

}

export default Account;