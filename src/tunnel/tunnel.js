import TunnelState from "./tunnel-state.js";

class Tunnel {
    constructor(tunnelId, account) {
        this.id = tunnelId;
        this.account = account;
        this.endpoints = {
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
            },
            sni: {
                enabled: false,
                url: undefined,
            }
        };
        this.upstream = {
            url: undefined,
        };
        this.created_at = undefined;
        this.updated_at = undefined;
        this._state = new TunnelState();
    }

    state() {
        return this._state;
    }

    isOwner(accountId) {
        return accountId != undefined && accountId === this.account;

    }
}

export default Tunnel;