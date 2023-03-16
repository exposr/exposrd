import assert from 'assert/strict';
import crypto from 'crypto';

const baseApi = "http://localhost:8080";

describe('API test', () => {
    let exposr;
    let terminator;

    before(async () => {
        process.env.NODE_ENV = "test-e2e";
        exposr = await import('../../src/index.js');
        terminator = await exposr.default([
            "node",
            "--admin-enable",
            "--allow-registration",
            "--ingress", "http",
            "--ingress-http-domain", "http://localhost:8080"
        ]);
    });

    after(async () => {
        await terminator(); 
    });

    it('Admin interface /ping', async () => {
        const res = await fetch("http://localhost:8081/ping");
        assert(res.status == 200, "/ping did not return 200");
    });

    it('API create account ', async () => {
        const res = await fetch(`${baseApi}/v1/account`, {
            method: 'POST'
        });
        assert(res.status == 201, "/v1/account did not return 201");
        const data = await res.json();
        assert(typeof data.account_id == 'string', "no account returned")
        assert(typeof data.account_id_hr == 'string', "no human readable account returned")
    });

    const createAccount = async () => {
        const res = await fetch(`${baseApi}/v1/account`, {
            method: 'POST'
        });
        return res.json();
    };

    const getAuthToken = async (accountId) => {
        const res = await fetch(`${baseApi}/v1/account/${accountId}/token`);
        const data = await res.json();
        return data.token;
    };

    const putTunnel = async (authToken, tunnelId, opts = {}) => {
        const res = await fetch(`${baseApi}/v1/tunnel/${tunnelId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(opts)
        });
        return res;
    }

    const getTunnel = async(authToken, tunnelId) => {
        const res = await fetch(`${baseApi}/v1/tunnel/${tunnelId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken}`
            },
        });
        return res;
    };

    const patchTunnel = async (authToken, tunnelId, opts = {}) => {
        const res = await fetch(`${baseApi}/v1/tunnel/${tunnelId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(opts)
        });
        return res;
    }

    it('API create tunnel ', async () => {
        const account = await createAccount();
        const authToken = await getAuthToken(account.account_id);

        const tunnelId = crypto.randomBytes(20).toString('hex');

        const res = await putTunnel(authToken, tunnelId);
        assert(res.status == 200, "did not get 200 from create tunnel api");

        const data = await res.json();
        assert(data.id == tunnelId, `tunnel not created, got ${data}`);
    });

    it('API create/update tunnel ', async () => {
        const account = await createAccount();
        const authToken = await getAuthToken(account.account_id);

        const tunnelId = crypto.randomBytes(20).toString('hex');

        let res = await putTunnel(authToken, tunnelId);
        assert(res.status == 200, "did not get 200 from create tunnel api");
        let data = await res.json();
        assert(data.id == tunnelId, `tunnel not created, got ${data}`);

        res = await patchTunnel(authToken, tunnelId, {
            target: {
                url: 'http://example.com'
            }
        });

        assert(res.status == 200, `did not get 200 from patch tunnel api, got ${res.status}`);
        data = await res.json();
        assert(data?.target?.url == 'http://example.com', `tunnel not updated,  got ${data}`);
    });

    it('API create/delete tunnel ', async () => {
        const account = await createAccount();
        const authToken = await getAuthToken(account.account_id);

        const tunnelId = crypto.randomBytes(20).toString('hex');

        let res = await putTunnel(authToken, tunnelId);
        assert(res.status == 200, "did not get 200 from create tunnel api");
        let data = await res.json();
        assert(data.id == tunnelId, `tunnel not created, got ${data}`);

        res = await fetch(`${baseApi}/v1/tunnel/${tunnelId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            },
        });
        assert(res.status == 204, "did not get 204 from delete tunnel api");

        res = await getTunnel(authToken, tunnelId);
        assert(res.status == 404, "tunnel not deleted");
    });
 
    it('API get non-existing tunnel returns 404 ', async () => {
        const account = await createAccount();
        const authToken = await getAuthToken(account.account_id);

        const res = await getTunnel(authToken, "non-existing-tunnel");
        assert(res.status == 404, `expected 404, got ${res.status}`);
    });

    it('API existing tunnel with wrong auth returns 401 ', async () => {
        const account = await createAccount();
        const authToken = await getAuthToken(account.account_id);
        const tunnelId = crypto.randomBytes(20).toString('hex');

        let res = await putTunnel(authToken, tunnelId);
        assert(res.status == 200, "did not get 200 from create tunnel api");

        res = await getTunnel(authToken, tunnelId);
        assert(res.status == 200, `could not read tunnel, got ${res.status}`);

        const account2 = await createAccount();
        const authToken2 = await getAuthToken(account2.account_id);
        res = await getTunnel(authToken2, tunnelId);
        assert(res.status == 404, `expected 404, got ${res.status}`);
    });
});