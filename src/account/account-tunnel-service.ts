import Tunnel from "../tunnel/tunnel.js";
import Account from "./account.js";
import Storage from '../storage/index.js';
import AccountService from "./account-service.js";
import { TunnelConfig } from "../tunnel/tunnel-config.js";

export default class AccountTunnelService {

    private storage: Storage;

    constructor() {
        this.storage = new Storage("account");
    }

    public async destroy(): Promise<void> {
        await this.storage.destroy();
    }

    public async assignTunnel(tunnelConfig: TunnelConfig): Promise<boolean> {

        const res = await this.storage.update(AccountService.normalizeId(tunnelConfig.account), Account, (account: Account) => {
            if (!account.tunnels.includes(tunnelConfig.account)) {
                account.tunnels.push(tunnelConfig.id);
            }
            account.updated_at = new Date().toISOString();
            return true;
        });
        return res instanceof Account;
    }

    public async unassignTunnel(tunnelConfig: TunnelConfig): Promise<boolean> {

        const res = await this.storage.update(AccountService.normalizeId(tunnelConfig.account), Account, (account: Account) => {
            const pos = account.tunnels.indexOf(tunnelConfig.id);
            if (pos >= 0) {
                account.tunnels.splice(pos, 1);
            }
            account.updated_at = new Date().toISOString();
            return true;
        });
        return res instanceof Account;
    }

    public async authorizedAccount(tunnel: Tunnel): Promise<Account> {
        const account = await this.storage.read(AccountService.normalizeId(tunnel.account), Account);
        if (!(account instanceof Account)) {
            throw new Error("dangling_account");
        }
        if (!account.tunnels.includes(tunnel.id)) {
            this.assignTunnel(tunnel.config);
        }
        return account;
    }
}