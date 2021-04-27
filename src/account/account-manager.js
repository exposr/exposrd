import assert from 'assert/strict';
import Storage from '../storage/index.js';
import Account from './account.js';
import { Logger } from '../logger.js'; const logger = Logger("account-manager");

class AccountManager {
    constructor() {
        this._db = new Storage("account");
    }

    async get(accountId) {
        assert(accountId != undefined);
        const normalizedId = Account.normalizeId(accountId);
        if (normalizedId == undefined) {
            return undefined;
        }

        const accountProps = await this._db.get(normalizedId);
        if (accountProps === undefined) {
            return false;
        }
        return new Account(normalizedId);
    }

    async create() {
        let accountId;
        do {
            accountId = Account.generateId();
            const created = await this._db.set(accountId, {}, {NX: true});
            if (!created) {
                accountId = undefined;
            }
        } while (accountId === undefined)

        return new Account(accountId);
    }

    async delete(accountId) {
        assert(accountId != undefined);
        const normalizedId = Account.normalizeId(accountId);
        if (normalizedId == undefined) {
            return undefined;
        }

        await this._db.delete(normalizedId);
        return true;
    }

}

export default AccountManager;