import TunnelState from "./tunnel-state.js";

// ORM object representing a tunnel
class Tunnel {
    constructor(tunnelId, account) {
        this.id = tunnelId;
        this.account = account;
        this.transport = {
            token: undefined,
            max_connections: undefined,
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
        this.target = {
            url: undefined,
        };
        this.created_at = undefined;
        this.updated_at = undefined;
        this._state = new TunnelState();
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