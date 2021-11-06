import AccountService from '../account/account-service.js';

// ORM object representing an account
class Account {

    constructor(accountId) {
        this.accountId = accountId;
        this.id = accountId;
        this.created_at = undefined;
        this.updated_at = undefined;
        this.tunnels = [];
        this.status = {
            disabled: false,
            disabled_at: undefined,
            disabled_reason: undefined,
        };
    }

    _deserialization_hook() {
        this.id ??= this.accountId;
        delete this.accountId;
        this.created_at ??= new Date().toISOString();
        this.updated_at ??= new Date().toISOString();
    }

    getId() {
        return {
            accountId: this.id,
            formatted: AccountService.formatId(this.id),
        }
    }
}

export default Account;