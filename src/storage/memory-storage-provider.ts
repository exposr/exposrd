import { Logger } from '../logger.js';
import StorageProvider, { AtomicValue, StorageProviderListResult, StorageErrorNotFound, StorageProviderError, StorageProviderOpts } from './storage-provider.js';
import LockService from '../lock/index.js';

export type MemoryStorageProviderOpts = {};
type _MemoryStorageProviderOpts = StorageProviderOpts & MemoryStorageProviderOpts;

class MemoryStorageProvider extends StorageProvider {
    private logger: any;
    private _lockService!: LockService;
    private db: { [key: string ]: any };
    private timers: { [key: string ]: NodeJS.Timeout };

    constructor(opts: _MemoryStorageProviderOpts) {
        super();
        this.logger = Logger("memory-storage");
        this.db = {};
        this.timers = {};

        new Promise((resolve: (lockService: LockService) => void, reject) => {
            const lock = new LockService("mem", {
                callback: (err?: Error) => { err ? reject(err) : resolve(lock) },
            });
        }).catch((err) => {
            typeof opts.callback === 'function' && process.nextTick(() => { opts.callback(err) });
        }).then((lock) => {
            this._lockService = <LockService>lock;
            typeof opts.callback === 'function' && process.nextTick(() => { opts.callback() });
        });
    }

    private updateTTL(ns: string, key: string, ttl?: number) {
        const compound_key = this.compound_key(ns, key);
        clearTimeout(this.timers[compound_key]);
        if (typeof ttl != 'number') {
            return;
        }
        this.timers[compound_key] = setTimeout(() => {
            delete this.db[ns][key]
        }, ttl * 1000);
    }

    protected async _destroy(): Promise<void> {
        await this._lockService.destroy();
    }

    protected async _init(ns: string): Promise<void> {
        this.db[ns] = {};
    }

    public async set(ns: string, key: string, value: string, ttl?: number): Promise<boolean> {
        if (this.db[ns] === undefined) {
            throw new StorageProviderError(ns, key, new Error('namespace_not_found'));
        }

        if (this.db[ns][key]) {
            return false;
        }
        this.db[ns][key] = value;
        this.updateTTL(ns, key, ttl);
        return true;
    }

    public async put(ns: string, key: string, value: string, ttl?: number): Promise<true> {
        if (this.db[ns] === undefined) {
            throw new StorageProviderError(ns, key, new Error('namespace_not_found'));
        }

        this.db[ns][key] = value;
        this.updateTTL(ns, key, ttl);
        return true;
    }

    public async get(ns: string, key: string): Promise<string> {
        if (this.db[ns] === undefined) {
            throw new StorageProviderError(ns, key, new Error('namespace_not_found'));
        }

        if (this.db[ns][key] === undefined) {
            throw new StorageErrorNotFound(ns, key);
        }
        return this.db[ns][key];
    }

    public async get_multi(ns: string, keys: Array<string>): Promise<Array<string | null>> {
        if (this.db[ns] === undefined) {
            throw new StorageProviderError(ns, new Error('namespace_not_found'));
        }

        return keys.map((k) => { return this.db[ns][k] ?? null; });
    }

    public async get_and_set(ns: string, key: string): Promise<AtomicValue>  {
        if (this.db[ns] === undefined) {
            throw new StorageProviderError(ns, key, new Error('namespace_not_found'));
        }

        const lock = await this._lockService.lock(key)
        if (!lock) {
            throw new StorageProviderError(ns, key, new Error('failed_to_lock_key'));
        }

        const value = this.db[ns][key] ?? null;
        if (value === null) {
            lock.unlock();
            throw new StorageErrorNotFound(ns, key);
        }
        return {
            value,
            release: async (newValue?: string, newTTL?: number) => {
                if (newValue !== undefined) {
                    this.db[ns][key] = newValue;
                }
                this.updateTTL(ns, key, newTTL);
                lock.unlock();
                return true;
            }
        }
    }

    public async delete(ns: string, key: string): Promise<true> {
        if (this.db[ns] === undefined) {
            throw new StorageProviderError(ns, key, new Error('namespace_not_found'));
        }
        if (this.db[ns][key] === undefined) {
            throw new StorageErrorNotFound(ns, key);
        }
        delete this.db[ns][key];
        return true;
    }

    public async list(ns: string, cursor: string | undefined, count: number): Promise<StorageProviderListResult> {
        if (this.db[ns] === undefined) {
            throw new StorageProviderError(ns, new Error('namespace_not_found'));
        }

        const cursor_num = Number(cursor ?? 0);
        const keys = Object.keys(this.db[ns]);
        const data = keys.slice(cursor_num, cursor_num + count);
        return {
            keys: data,
            cursor: data.length > 0 ? String(cursor_num + data.length) : null,
        }
    }
}

export default MemoryStorageProvider;