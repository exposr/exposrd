import assert from 'assert/strict';
import { Logger } from '../logger.js';
import Storage from '../storage/index.js';
import Account from './account.js';

const logger = Logger("account-service");

class AccountService {
    static ACCOUNT_ID_ALPHABET = 'CDEFHJKMNPRTVWXY2345689';
    static ACCOUNT_ID_LENGTH = 16;
    static ACCOUNT_ID_REGEX = new RegExp(`^[${AccountService.ACCOUNT_ID_ALPHABET}]{${AccountService.ACCOUNT_ID_LENGTH}}$`);

    static generateId() {
        return [...Array(AccountService.ACCOUNT_ID_LENGTH)]
            .map(() => {
                const randomPos = Math.floor(Math.random() * AccountService.ACCOUNT_ID_ALPHABET.length);
                return AccountService.ACCOUNT_ID_ALPHABET[randomPos];
            })
            .join('');
    }

    static normalizeId(accountId) {
        const normalized = accountId.replace(/ /g, '').toUpperCase();
        if (AccountService.ACCOUNT_ID_REGEX.test(normalized)) {
            return normalized;
        } else {
            return undefined;
        }
    }

    static formatId(accountId) {
        return accountId.replace(/.{1,4}(?=(.{4})+$)/g, '$& ');
    }

    constructor() {
        this._db = new Storage("account");
    }

    async destroy() {
        await this._db.destroy();
    }

    async get(accountId) {
        assert(accountId != undefined);
        const normalizedId = AccountService.normalizeId(accountId);
        if (normalizedId == undefined) {
            return undefined;
        }

        const account = await this._db.read(normalizedId, Account);
        return account;
    }

    async create() {
        let maxTries = 100;
        let created;
        let account;
        do {
            account = new Account(AccountService.generateId());
            account.created_at = new Date().toISOString();
            account.updated_at = account.created_at;
            created = await this._db.create(account.id, account);
        } while (!created && maxTries-- > 0);

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

    async update(accountId, callback) {
        assert(accountId != undefined);
        const normalizedId = AccountService.normalizeId(accountId);
        if (normalizedId == undefined) {
            return undefined;
        }
        return this._db.update(AccountService.normalizeId(normalizedId), Account, (account) => {
            callback(account);
            account.updated_at = new Date().toISOString();
        });
    }

}

export default AccountService;