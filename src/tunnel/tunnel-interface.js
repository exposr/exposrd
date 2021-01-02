import { strict as assert } from 'assert';

class TunnelInterface {

    constructor(tunnel, endpoint) {
        this.tunnel = tunnel;
        this.endpoint = endpoint;
    }

    authenticate(token) {
        return this.tunnel.authToken === token;
    }

    httpRequest(sock, res, req, head) {
        assert.fail("httpRequest not implemented")
    }
}

export default TunnelInterface;