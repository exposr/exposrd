import { Serializable } from '../storage/serializer.js';

type AccountStatus = {
    disabled: boolean,
    disabled_at?: string,
    disabled_reason?: string,
}

class Account implements Serializable {
    public accountId: string;
    public id: string;
    public created_at?: string;
    public updated_at?: string;
    public tunnels: Array<string>;
    public status: AccountStatus;

    constructor(accountId: string) {
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
}

export default Account;