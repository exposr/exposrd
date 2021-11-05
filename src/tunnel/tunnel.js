import AccountService from "../account/account-service.js";
import TunnelState from "./tunnel-state.js";
import { safeEqual } from "../utils/misc.js";

class Tunnel {
    constructor(tunnelId, account) {
        this.id = tunnelId;
        this.account = account;
        this.transport = {
            token: undefined,
            ws: {
                enabled: false,
            },
            ssh: {
                enabled: false,
            },
        };
        this.ingress = {
            http: {
                enabled: false,
                url: undefined,
                urls: undefined,
                alt_names: [],
            },
            sni: {
                enabled: false,
                url: undefined,
                urls: undefined,
            },
        };
        this.upstream = {
            url: undefined,
        };
        this.created_at = undefined;
        this.updated_at = undefined;
        this._state = new TunnelState();

        this._accountService = new AccountService();
    }

    _deserialization_hook() {
        if (this.endpoints != undefined) {
            this.transport = this.endpoints;
            delete this.endpoints;
        }
    }

    state() {
        return this._state;
    }

    isOwner(accountId) {
        return accountId != undefined && accountId === this.account;
    }

    async authorize(token) {
        const correctToken = safeEqual(token, this.transport.token)
        let account;
        try {
            account = await this.getAccount();
        } catch (e) {
            return {
                authorized: false,
                account: undefined,
                error: e,
            }
        }
        const authorized = correctToken && !account.status.disabled;

        return {
            authorized,
            account,
            disabled: account.status.disabled,
        }
    }

    async getAccount() {
        return this._accountService.get(this.account);
    }

    clone() {
        const stringify = (object) => JSON.stringify(object, (key, value) => {
            if (key[0] == '_') {
                return undefined;
            }
            return value;
        });

        return Object.assign(new Tunnel(), JSON.parse(stringify(this)));
    }
}

export default Tunnel;