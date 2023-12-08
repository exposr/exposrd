import assert from 'assert/strict';
import crypto from 'crypto';
import sinon from 'sinon';
import AccountService from '../../../src/account/account-service.js';
import { initClusterService, initStorageService } from '../test-utils.js';
import Config from '../../../src/config.js';
import { StorageService } from '../../../src/storage/index.js';
import Account from '../../../src/account/account.js';
import TunnelService from '../../../src/tunnel/tunnel-service.js';
import ClusterService from '../../../src/cluster/index.js';

describe('account service', () => {
    it('can generate account ids', async () => {

        for (let i = 0; i < 1000; i++) {
            const accountId = AccountService.generateId();
            const validAccount = new RegExp(`^[${AccountService['ACCOUNT_ID_ALPHABET']}]{${AccountService['ACCOUNT_ID_LENGTH']}}$`);

            const valid = validAccount.test(accountId);
            assert(valid == true, `generated invalid account id, ${accountId}`);
        }
    });

    const formatTest = [
        { input: "MPW4YDYVNPFXVV2D", expected: "MPW4-YDYV-NPFX-VV2D" },
        { input: "XDF", expected: "XDF" }
    ];
    formatTest.forEach(({input, expected}) => {
        it(`can format ${input} account ids`, () => {
            const formatted = AccountService.formatId(input);
            assert(formatted == expected, `expected ${expected}, got ${formatted}`);
        });
    });

    const normalizeTest = [
        { input: "MPW4YDYVNPFXVV2D", expected: "MPW4YDYVNPFXVV2D" },
        { input: "MPW4-YDYV-NPFX-VV2D", expected: "MPW4YDYVNPFXVV2D" },
        { input: "MPW4 YDYV NPFX VV2D", expected: "MPW4YDYVNPFXVV2D" },
        { input: "MPW4 YDYV NPFXVV2D", expected: "MPW4YDYVNPFXVV2D" },
        { input: "MPW4  YDYV  NPFX VV2D", expected: "MPW4YDYVNPFXVV2D" },
    ];
    normalizeTest.forEach(({input, expected}) => {
        it(`can normalize ${input} account ids`, () => {
            const normalized = AccountService.normalizeId(input);
            assert(normalized == expected, `expected ${expected}, got ${normalized}`);
        });
    });

    let config: Config;
    let storageService: StorageService;
    let clusterService: ClusterService;
    let accountService: AccountService;
    let tunnelService: TunnelService;

    beforeEach(async () => {
        config = new Config();
        storageService = await initStorageService();
        clusterService = initClusterService();
        accountService = new AccountService();
        tunnelService = new TunnelService();
    });

    afterEach(async () => {
        await accountService.destroy(); 
        await tunnelService.destroy();
        await storageService.destroy();
        await clusterService.destroy();
        await config.destroy();
        sinon.restore();
    })

    it(`can create account`, async () => {
        const account = await accountService.create();
        assert(account instanceof Account);
        assert(account.created_at != undefined);
        assert(account.created_at == account.updated_at);

        const account2 = await accountService.get(account.id);
        assert(account2 instanceof Account);

        assert(account.id == account2.id);
    });

    it(`can create account with initial collision`, async () => {
        const account = await accountService.create();
        assert(account?.id != undefined)

        const stub = sinon.stub(AccountService, "generateId")
            .onFirstCall().returns(account.id)
            .callThrough();

        const account2 = await accountService.create();

        assert(account2?.id != undefined);
        assert(account2.id != account.id);
        assert(stub.callCount == 2);
    });

    it(`account creation fails on collision`, async () => {
        const account = await accountService.create();
        assert(account?.id != undefined)

        sinon.stub(AccountService, "generateId")
            .returns(account.id)

        const account2 = await accountService.create();
        assert(account2 == undefined);
    });

    it(`account can have tunnels`, async () => {
        let account = await accountService.create();
        assert(account?.id != undefined)

        const tunnelId = crypto.randomBytes(20).toString('hex');
        const tunnel = await tunnelService.create(tunnelId, account.id);

        account = await accountService.get(account.id);

        assert(account?.tunnels[0] == tunnel?.id);
    });

    it(`deleted tunnels are removed from account`, async () => {
        let account = await accountService.create();
        assert(account?.id != undefined)

        const tunnelId = crypto.randomBytes(20).toString('hex');
        const tunnel = await tunnelService.create(tunnelId, account.id);
        account = await accountService.get(account.id);
        assert(account?.tunnels[0] == tunnel?.id);

        assert(account?.id != undefined)
        await tunnelService.delete(tunnelId, account.id);

        account = await accountService.get(account.id);
        assert(account?.tunnels.length == 0);
    });

    it(`removing account deletes tunnels`, async () => {
        let account = await accountService.create();
        assert(account?.id != undefined)

        const tunnelId = crypto.randomBytes(20).toString('hex');
        let tunnel = await tunnelService.create(tunnelId, account.id);
        account = await accountService.get(account.id);
        assert(account?.tunnels[0] == tunnel?.id);

        assert(account?.id != undefined);
        await accountService.delete(account.id);

        account = await accountService.get(account.id);
        assert(account == undefined, "account not removed");

        let error: Error | undefined = undefined;
        try {
            tunnel = await tunnelService.lookup(tunnelId);
        } catch (e: any) {
            error = e;
        }
        assert(error?.message == "no_such_tunnel", "tunnel not removed");
    });

    it(`can list all accounts`, async () => {
        for (let i = 0; i < 100; i++) {
            await accountService.create();
        }

        const expectedAccounts = 100;

        let cursor: any;
        let accounts: number = 0;
        do {
            const result = await accountService.list(cursor, 10, false);
            accounts += result.accounts.length;
            cursor = result.cursor;
        } while (cursor != null);

        assert(accounts == expectedAccounts, "wrong number of accounts");

        accounts = 0;
        do {
            const result = await accountService.list(cursor, 10, true);
            accounts += result.accounts.length;
            cursor = result.cursor;
        } while (cursor != null);

        assert(accounts == expectedAccounts, "wrong number of tunnels");
    });

    it(`can disable account`, async () => {
        let account = await accountService.create();
        assert(account?.id != undefined)

        const tunnelId = crypto.randomBytes(20).toString('hex');
        const tunnel = await tunnelService.create(tunnelId, account.id);
        account = await accountService.get(account.id);
        assert(account?.tunnels[0] == tunnel?.id);

        assert(account?.id != undefined)
        await accountService.disable(account.id, true, "spam");

        account = await accountService.get(account.id);
        assert(account?.status.disabled == true);
        assert(account?.status.disabled_at != undefined);
        assert(account?.status.disabled_reason == "spam");
    });

    it(`can enable account`, async () => {
        let account = await accountService.create();
        assert(account?.id != undefined)

        const tunnelId = crypto.randomBytes(20).toString('hex');
        const tunnel = await tunnelService.create(tunnelId, account.id);
        account = await accountService.get(account.id);
        assert(account?.tunnels[0] == tunnel?.id);

        assert(account?.id != undefined)
        await accountService.disable(account.id, true, "spam");

        account = await accountService.get(account.id);
        assert(account?.status.disabled == true);
        assert(account?.status.disabled_at != undefined);
        assert(account?.status.disabled_reason == "spam");

        await accountService.disable(account.id, false); 
        account = await accountService.get(account.id);
        assert(account?.status.disabled == false);
        assert(account?.status.disabled_at == undefined);
        assert(account?.status.disabled_reason == undefined);
    });
});