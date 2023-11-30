import Storage from '../storage/index.js';
import Account from './account.js';
import crypto from 'crypto';
import { Logger } from '../logger.js';
import TunnelService from '../tunnel/tunnel-service.js';

type AccountListResult = {
    cursor: string | null,
    accounts: Array<Account>,
};

class AccountService {
    private static ACCOUNT_ID_ALPHABET = 'CDEFHJKMNPRTVWXY2345689';
    private static ACCOUNT_ID_LENGTH = 16;
    private static ACCOUNT_ID_REGEX = new RegExp(`^[${AccountService.ACCOUNT_ID_ALPHABET}]{${AccountService.ACCOUNT_ID_LENGTH}}$`);

    static generateId(): string {
        const randomBytes = new Uint8Array(AccountService.ACCOUNT_ID_LENGTH);
        crypto.getRandomValues(randomBytes);

        return [...randomBytes]
            .map(x => {
                const randomPos = x % AccountService.ACCOUNT_ID_ALPHABET.length;
                return AccountService.ACCOUNT_ID_ALPHABET[randomPos];
            })
            .join('');
    }

    static normalizeId(accountId: string): string | undefined {
        const normalized = accountId.replace(/[ -]/g, '').toUpperCase();
        if (AccountService.ACCOUNT_ID_REGEX.test(normalized)) {
            return normalized;
        } else {
            return undefined;
        }
    }

    static formatId(accountId: string): string {
        return accountId.replace(/.{1,4}(?=(.{4})+$)/g, '$&-');
    }

    private _db: Storage;
    private logger: any;
    private tunnelService: TunnelService;

    constructor() {
        this._db = new Storage("account");
        this.logger = Logger("account-service");
        this.tunnelService = new TunnelService();
    }

    public async destroy(): Promise<void> {
        await this.tunnelService.destroy();
        await this._db.destroy();
    }

    public async get(accountId: string): Promise<undefined | Account> {
        const normalizedId = AccountService.normalizeId(accountId);
        if (normalizedId == undefined) {
            return undefined;
        }

        const account = await this._db.read(normalizedId, Account);
        return account;
    }

    public async create(): Promise<undefined | Account> {
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

    async delete(accountId: string): Promise<boolean> {
        const account = await this.get(accountId);
        if (!(account instanceof Account)) {
            return false;
        }

        const tunnels = [...account.tunnels];
        try {
            await Promise.allSettled(tunnels.map((tunnelId) => {
                return this.tunnelService.delete(tunnelId, accountId)
            }));
        } catch (e) {
            this.logger.error({
                message: `Failed to delete account`,
                accountId
            });
            return false;
        }

        await this._db.delete(account.id);
        return true;
    }

    async update(accountId: string, callback: (account: Account) => void): Promise<undefined | Account> {
        const normalizedId = AccountService.normalizeId(accountId);
        if (normalizedId == undefined) {
            return undefined;
        }
        return this._db.update(AccountService.normalizeId(normalizedId), Account, (account: Account) => {
            callback(account);
            account.updated_at = new Date().toISOString();
            return true;
        });
    }

    public async list(cursor: string | undefined, count: number = 10, verbose: boolean = false): Promise<AccountListResult> {
        const res = await this._db.list(<any>cursor, count);

        const data: Array<Account> = verbose ? (await this._db.read(res.data, Account) || []) : res.data.map((id: string) => {
            return new Account(id);
        });
        return {
            cursor: res.cursor,
            accounts: data,
        }
    }

    async disable(accountId: string, disabled: boolean, reason?: string): Promise<Account | undefined> {
        const account = await this.update(accountId, (account) => {
            account.status.disabled = disabled;
            if (account.status.disabled) {
                account.status.disabled_at = new Date().toISOString();
                account.status.disabled_reason = reason;
            } else {
                account.status.disabled_at = undefined;
                account.status.disabled_reason = undefined;
            }
        });

        if (!account) {
            return undefined;
        }

        if (account.status.disabled) {
            try {
                await Promise.allSettled(account.tunnels.map((tunnelId) => {
                    return this.tunnelService.disconnect(tunnelId, accountId)
                }));
            } catch (e: any) {
                this.logger.warn({
                    message: `Failed to disconnect tunnels on disabled account`,
                    accountId
                });
            }
        }
        return account;
    }

}

export default AccountService;