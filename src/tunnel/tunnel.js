class Tunnel {
    constructor(tunnelId, account) {
        this.id = tunnelId;
        this.account = account;
        this.endpoints = {
            ws: {
                enabled: false,
                url: undefined,
                token: undefined,
            },
        };
        this.ingress = {
            http: {
                enabled: false,
                url: undefined,
            }
        };
        this.upstream = {
            url: undefined,
        };
        this.connected = false;
        this.connection = {
            peer: undefined,
            node: undefined,
        };
    }
}

export default Tunnel;