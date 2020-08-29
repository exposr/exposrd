import { strict as assert } from 'assert';

class TunnelInterface {

    constructor(endpoint) {
        this.endpoint = endpoint;
    }

    httpRequest(sock, res, req, head) {
        assert.fail("httpRequest not implemented")
    }
}

export default TunnelInterface;