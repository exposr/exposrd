class TunnelState {
    constructor() {
        this.connected = false;
        this.peer = undefined;
        this.node = undefined;
        this.connected_at = undefined;
        this.disconnected_at = undefined;
        this.alive_at = undefined;
        this.connections = [];
    }
}

export default TunnelState;