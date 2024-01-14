import Tunnel from "../tunnel/tunnel.js";
import Account from "./account.js";
import AccountService from "./account-service.js";
import { TunnelConfig } from "../tunnel/tunnel-config.js";
import Storage from "../storage/storage.js";

export default class AccountTunnelService {

    private storage: Storage;

    constructor() {
        this.storage = new Storage("account");
    }

    public async destroy(): Promise<void> {
        await this.storage.destroy();
    }

    public async assignTunnel(tunnelConfig: TunnelConfig): Promise<boolean> {
        const normalizedId = AccountService.normalizeId(<string>tunnelConfig.account);
        if (normalizedId == undefined) {
            return false;
        }

        const res = await this.storage.update(normalizedId, Account, async (account: Account) => {
            if (!account.tunnels.includes(<string>tunnelConfig.account)) {
                account.tunnels.push(<string>tunnelConfig.id);
            }
            account.updated_at = new Date().toISOString();
            return true;
        });
        return res instanceof Account;
    }

    public async unassignTunnel(tunnelConfig: TunnelConfig): Promise<boolean> {
        const normalizedId = AccountService.normalizeId(<string>tunnelConfig.account);
        if (normalizedId == undefined) {
            return false;
        }

        const res = await this.storage.update(normalizedId, Account, async (account: Account) => {
            const pos = account.tunnels.indexOf(<string>tunnelConfig.id);
            if (pos >= 0) {
                account.tunnels.splice(pos, 1);
            }
            account.updated_at = new Date().toISOString();
            return true;
        });
        return res instanceof Account;
    }

    public async authorizedAccount(tunnel: Tunnel): Promise<Account> {
        const normalizedId = AccountService.normalizeId(<string>tunnel.account);
        if (normalizedId == undefined) {
            throw new Error("no_account_on_tunnel");
        }

        const account = await this.storage.read(normalizedId, Account);
        if (!(account instanceof Account)) {
            throw new Error("dangling_account");
        }
        if (!account.tunnels.includes(<string>tunnel.id)) {
            this.assignTunnel(tunnel.config);
        }
        return account;
    }
}