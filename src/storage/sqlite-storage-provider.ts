import LockService from '../lock/index.js';
import { Logger } from '../logger.js';
import StorageProvider, { AtomicValue, StorageErrorNotFound, StorageProviderError, StorageProviderListResult, StorageProviderOpts } from './storage-provider.js';
import Sqlite from 'better-sqlite3';

export type SqliteStorageProviderOpts = {};
type _SqliteStorageProviderOpts = StorageProviderOpts & SqliteStorageProviderOpts;

interface TableLayout {
    key?: string;
    value?: string;
    modified_at?: number;
    expires_at?: number | null;
}

class SqliteStorageProvider extends StorageProvider {
    private logger: any;
    private _db: Sqlite.Database;
    private expiryCleanInterval: number;
    private _ns_init: { [key: string]: { expiryTimer: NodeJS.Timeout, cleanExpired: () => void } };
    private _lockService!: LockService;

    constructor(opts: _SqliteStorageProviderOpts) {
        super();
        this.logger = Logger("sqlite-storage");

        const url = opts?.url;
        const db_file = url ? url?.href?.slice(url?.protocol?.length + 2) : "db.sqlite";
        this._db = new Sqlite(db_file)
        this._db.pragma('journal_mode = WAL');
        this.expiryCleanInterval = 5 * 60 * 1000;
        this._ns_init = {};
        this.logger.info({
            message: `SQlite storage initialized: ${db_file}`
        });

        new Promise((resolve: (lock: LockService) => void, reject) => {
            const lock = new LockService("mem", {
                callback: (err: Error) => { err ? reject(err) : resolve(lock) },
            });
        }).catch((err) => {
            typeof opts.callback === 'function' && process.nextTick(() => { opts.callback(err) });
        }).then((lock) => {
            this._lockService = <LockService>lock;
            typeof opts.callback === 'function' && process.nextTick(() => { opts.callback() });
        });
    }

    private _get_ns(ns: string): string {
        ns = ns.replace(/-/g, "_").toLowerCase();
        return isNaN(Number(ns[0])) ? ns : 't_' + ns;
    }

    protected async _destroy(): Promise<void> {
        Object.keys(this._ns_init).forEach((ns) => {
            clearInterval(this._ns_init[ns].expiryTimer);
            this._ns_init[ns].cleanExpired();
            delete this._ns_init[ns];
        });
        this._ns_init = {};
        this._db.close();
        await this._lockService?.destroy();
    }

    protected async _init(ns: string): Promise<void> {
        ns = this._get_ns(ns);
        if (this._ns_init[ns]) {
            return;
        }

        this._db.prepare(`
            CREATE TABLE IF NOT EXISTS ${ns} (
              key TEXT PRIMARY KEY,
              value BLOB,
              modified_at INTEGER,
              expires_at INTEGER NULL
            )
        `).run();

        this._db.prepare(`
            CREATE INDEX IF NOT EXISTS idx_${ns}_modified_at
            ON ${ns} (modified_at)
        `).run();

        this._db.prepare(`
            CREATE INDEX IF NOT EXISTS idx_${ns}_expires_at
            ON ${ns} (expires_at)
        `).run();

        const cleanExpired = () => {
            try {
                this._db.prepare(`
                    DELETE FROM ${ns} WHERE expires_at < ? AND expires_at IS NOT NULL
                `).run(Math.floor(Date.now() / 1000));
            } catch (e: any) {
                this.logger.error({
                    message: `failed to clean expired database entries: ${e.message}`
                });
            }
        };

        this._ns_init[ns] = {
            cleanExpired,
            expiryTimer: setInterval(cleanExpired, this.expiryCleanInterval),
        };
        cleanExpired();
    }

    public async set(ns: string, key: string, value: string, ttl?: number): Promise<boolean> {
        ns = this._get_ns(ns);

        let expires: number | undefined = undefined;
        if (ttl !== undefined) {
            expires = Math.floor(Date.now() / 1000) + ttl;
        }

        try {
            const stm = this._db.prepare(`
                INSERT INTO ${ns} (key, value, modified_at, expires_at) VALUES (?, ?, unixepoch(), ?)
                    ON CONFLICT(key) DO NOTHING;
            `);

            const res = stm.run(key, value, expires);
            return res.changes == 1 ? true : false;
        } catch (e: any) {
            throw new StorageProviderError(ns, key, e);
        }
    }

    public async put(ns: string, key: string, value: string, ttl?: number): Promise<true> {
        ns = this._get_ns(ns);

        let expires: number | undefined = undefined;
        if (ttl !== undefined) {
            expires = Math.floor(Date.now() / 1000) + ttl;
        }

        try {
            const stm = this._db.prepare(`
                INSERT INTO ${ns} (key, value, modified_at, expires_at) VALUES (?, ?, unixepoch(), ?)
                    ON CONFLICT(key) DO UPDATE SET
                        value=excluded.value,
                        modified_at=excluded.modified_at,
                        expires_at=excluded.expires_at;
            `);

            const res = stm.run(key, value, expires);
            if (res.changes != 1) {
                throw new StorageProviderError(ns, key, new Error('failed_to_put'));
            }
            return true;
        } catch (e: any) {
            throw new StorageProviderError(ns, key, e);
        }
    }

    public async get(ns: string, key: string): Promise<string> {
        ns = this._get_ns(ns);

        try {
            const stm = this._db.prepare(`
                SELECT value from ${ns} WHERE
                    key = ? AND (
                        expires_at > ?
                        OR
                        expires_at IS NULL
                    )
            `);

            const expires_at = Math.floor(Date.now() / 1000);
            const res = stm.get(key, expires_at) as TableLayout;
            const value = res?.value || null;
            if (value == null) {
                throw new StorageErrorNotFound(ns, key);
            }
            return value;
        } catch (e: any) {
            if (e instanceof StorageErrorNotFound) {
                throw e;
            } else {
                throw new StorageProviderError(ns, key, e);
            }
        }
    }

    public async get_multi(ns: string, keys: Array<string>): Promise<Array<string | null>> {
        ns = this._get_ns(ns);

        try {
            const stm = this._db.prepare(`
                SELECT key,value from ${ns} WHERE
                    key IN (${new Array(keys.length).fill("?").join(',')}) AND
                    (expires_at > ? OR expires_at IS NULL)
            `);

            const res = stm.all(keys, Math.floor(Date.now() / 1000)) as TableLayout[];

            const kv = res.reduce((acc, curr) => {
                if (curr.key != undefined && curr.value != undefined) {
                    acc[curr.key as string] = curr.value as string;
                }
                return acc;
            }, {} as { [key: string]: string });

            return keys.map((key) => kv[key] || null);
        } catch (e: any) {
            throw new StorageProviderError(ns, e);
        }
    }

    public async get_and_set(ns: string, key: string): Promise<AtomicValue> {

        const lock = await this._lockService.lock(this.compound_key(ns, key));
        if (!lock) {
            throw new StorageProviderError(ns, key, new Error('failed_to_lock_key'));
        }

        let value: string | null = null;
        try {
            value = await this.get(ns, key);
        } catch (e: any) {
            lock.unlock();
            if (!(e instanceof StorageErrorNotFound)) {
                throw e;
            }
        }
        return {
            value,
            release: async (value?: string, ttl?: number) => {
                if (value) {
                    await this.put(ns, key, value, ttl);
                }
                lock.unlock();
                return true;
            }
        };
    }

    public async delete(ns: string, key: string): Promise<true> {
        ns = this._get_ns(ns);

        try {
            const stm = this._db.prepare(`
                DELETE FROM ${ns} WHERE key = ?
            `);
            const res = stm.run(key);
            if (res.changes != 1) {
                throw new StorageErrorNotFound(ns, key);
            }
            return true;
        } catch (e: any) {
            if (e instanceof StorageErrorNotFound) {
                throw e;
            } else {
                throw new StorageProviderError(ns, key, e);
            }
        }
    }

    public async list(ns: string, cursor: string | undefined, count: number): Promise<StorageProviderListResult> {
        ns = this._get_ns(ns);

        cursor ??= '';
        count ??= 10;
        try {
            const stm = this._db.prepare(`
                SELECT key FROM ${ns}
                    WHERE
                        (expires_at > unixepoch() OR expires_at IS NULL)
                        AND
                        key > ?
                    ORDER BY key
                    LIMIT ?
            `);

            const res: string[] = (stm.all(cursor, count) as TableLayout[])
                .map(({ key }) => key)
                .filter((key) => key != undefined) as string[];

            return {
                cursor: res.length > 0 ? res[res.length - 1] : null,
                keys: res,
            }

        } catch (e: any) {
            throw new StorageProviderError(ns, e);
        }
    }
}

export default SqliteStorageProvider;