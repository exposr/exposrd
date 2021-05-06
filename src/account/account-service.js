import assert from 'assert/strict';
import { Logger } from '../logger.js';
import Storage from '../storage/index.js';
import Account from './account.js';

const logger = Logger("account-service");
class AccountService {
    constructor() {
        this._db = new Storage("account");
    }

    async get(accountId) {
        assert(accountId != undefined);
        const normalizedId = Account.normalizeId(accountId);
        if (normalizedId == undefined) {
            return undefined;
        }

        const account = await this._db.read(accountId, Account);
        return account;
    }

    async create() {
        let maxTries = 100;
        let created;
        let account;
        do {
            account = new Account();
            created = await this._db.create(account.accountId, account);
        } while (!created && accountId === undefined && maxTries-- > 0);

        if (!created) {
            return undefined;
        }

        return account;
    }

    async delete(accountId) {
        assert(accountId != undefined);
        const account = this.get(accountId);
        if (account instanceof Account) {
            await this._db.delete(account.accountId);
            return true;
        } else {
            return false;
        }
    }

}

export default AccountService;