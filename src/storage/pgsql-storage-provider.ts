import { Logger } from '../logger.js';
import StorageProvider, { AtomicValue, StorageErrorNotFound, StorageProviderError, StorageProviderListResult, StorageProviderOpts } from './storage-provider.js';
import Pgsql, { QueryResult, QueryResultBase } from 'pg';

export type PgsqlStorageProviderOpts = {
    poolSize?: number;
};

type _PgsqlStorageProviderOpts = StorageProviderOpts & PgsqlStorageProviderOpts;

interface TableLayout {
    key?: string;
    value?: object; // JSONB
    modified_at?: number;
    expires_at?: number | null;
}

export default class PgsqlStorageProvider extends StorageProvider {
    private logger: any;
    private expiryCleanInterval: number;
    private _db: Pgsql.Pool;
    private _ns_init: { [key: string]: Promise<{ expiryTimer: NodeJS.Timeout }> };

    constructor(opts: _PgsqlStorageProviderOpts) {
        super();
        this.logger = Logger("pgsql-storage");
        this.expiryCleanInterval = 5 * 60 * 1000;
        this._ns_init = {};

        const url = typeof opts.url == 'string' ? new URL(opts.url) : opts.url;
        const poolSize = opts.poolSize || 10;

        this._db = new Pgsql.Pool({
            connectionString: url.href,
            max: poolSize,
        });

        this._db.on('error', (err, client) => {
            this.logger.error({
                message: `Postgres database error: ${err.message}`
            });
        });

        this._db.connect((err, client, release) => {
            if (err) {
                this.logger.error({
                    message: `Failed to connect to postgres: ${err.message}`
                });
                this.logger.debug({
                    error: err.message,
                    stack: err.stack
                });
                typeof opts.callback === 'function' && process.nextTick(() => { opts.callback(err) });
                return;
            }

            if (client == undefined) {
                return;
            }

            client.query('SELECT NOW()', (err, result) => {
                release();
                if (!err) {
                    this.logger.info({
                        message: `Connected to postgres database: ${url.host} (max pool size ${poolSize})`
                    });
                } else {
                    this.logger.error({
                        message: `Postgres connection not usable: ${err.message}`
                    });
                }
                typeof opts.callback === 'function' && process.nextTick(() => { opts.callback(err) });
            });
        });
    }

    private _get_ns(ns: string): string {
        ns = ns.replace(/-/g, "_").toLowerCase();
        return isNaN(Number(ns[0])) ? ns : 't_' + ns;
    }

    async _destroy(): Promise<void> {
        Object.keys(this._ns_init).forEach(async (ns) => {
            const obj = await this._ns_init[ns];
            clearInterval(obj.expiryTimer);
            delete this._ns_init[ns];
        });
        this._ns_init = {};
        await this._db.end();
    }

    async _init(ns: string): Promise<void> {
        ns = this._get_ns(ns);

        this._ns_init[ns] ??= new Promise(async (resolve) => {
            let client: Pgsql.PoolClient | undefined = undefined;
            try {
                client = await this._db.connect();
                await client.query(`
                    CREATE TABLE IF NOT EXISTS ${ns} (
                      key TEXT PRIMARY KEY,
                      value JSONB NOT NULL,
                      modified_at TIMESTAMP NOT NULL,
                      expires_at TIMESTAMP NULL
                    )
                `);

                await client.query(`
                    CREATE INDEX IF NOT EXISTS idx_${ns}_modified_at
                    ON ${ns} (modified_at)
                `);

                await client.query(`
                    CREATE INDEX IF NOT EXISTS idx_${ns}_expires_at
                    ON ${ns} (expires_at)
                `);
            } catch (e: any) {
                this.logger.error({
                    message: `failed to create table '${ns}': ${e.message}`
                });
                throw e;
            } finally {
                client?.release();
            }

            const cleanExpired = async () => {
                let expiryClient: Pgsql.PoolClient | undefined = undefined;
                try {
                    expiryClient = await this._db.connect();
                    await expiryClient.query(`
                        DELETE FROM ${ns} WHERE expires_at < TO_TIMESTAMP($1) AND expires_at IS NOT NULL
                    `, [Math.floor(Date.now() / 1000)]);
                } catch (e: any) {
                    this.logger.error({
                        message: `failed to clean expired database entries in table '${ns}': ${e.message}`
                    });
                } finally {
                    expiryClient?.release();
                }
            };

            const expiry = {
                expiryTimer: setInterval(cleanExpired, this.expiryCleanInterval),
            };
            cleanExpired();
            resolve(expiry);
        });
    }

    public async set(ns: string, key: string, value: string, ttl?: number): Promise<boolean> {
        ns = this._get_ns(ns);
        if (this._ns_init[ns] == undefined) {
            throw new StorageProviderError(ns, key, new Error('namespace_not_found'));
        }
        await this._ns_init[ns];

        let result: boolean;
        let client: Pgsql.PoolClient | undefined = undefined;
        try {
            client = await this._db.connect();

            let expires: number | undefined = undefined;
            if (ttl != undefined) {
                expires = Math.floor(Date.now() / 1000) + ttl;
            }

            let query: any = {
                text: `INSERT INTO ${ns} (key, value, modified_at, expires_at) VALUES ($1, $2, NOW(), TO_TIMESTAMP($3))
                    ON CONFLICT(key) DO NOTHING;`
            };

            const res = await client.query(query, [key, value, expires])
            result = res?.rowCount == 1 ? true : false;
            return result;
        } catch (e: any) {
            throw new StorageProviderError(ns, key, e);
        } finally {
            client?.release();
        }
    }

    public async put(ns: string, key: string, value: string, ttl?: number): Promise<true> {
        ns = this._get_ns(ns);
        if (this._ns_init[ns] == undefined) {
            throw new StorageProviderError(ns, key, new Error('namespace_not_found'));
        }
        await this._ns_init[ns];

        let client: Pgsql.PoolClient | undefined = undefined;
        try {
            client = await this._db.connect();

            let expires: number | undefined = undefined;
            if (ttl != undefined) {
                expires = Math.floor(Date.now() / 1000) + ttl;
            }

            let query: any = {
                text: `INSERT INTO ${ns} (key, value, modified_at, expires_at) VALUES ($1, $2, NOW(), TO_TIMESTAMP($3))
                    ON CONFLICT(key) DO UPDATE SET
                        value=excluded.value,
                        modified_at=excluded.modified_at,
                        expires_at=excluded.expires_at;`
            };

            const res = await client.query(query, [key, value, expires])
            if (res?.rowCount != 1) {
                throw new Error(`failed_to_put, rowCount ${res.rowCount}}`);
            }
            return true;
        } catch (e: any) {
            throw new StorageProviderError(ns, key, e);
        } finally {
            client?.release();
        }
    }

    public async get(ns: string, key: string): Promise<object> {
        ns = this._get_ns(ns);
        if (this._ns_init[ns] == undefined) {
            throw new StorageProviderError(ns, key, new Error('namespace_not_found'));
        }
        await this._ns_init[ns];

        let client: Pgsql.PoolClient | undefined = undefined;
        try {
            client = await this._db.connect();
            const res = await client.query<TableLayout>(`
                SELECT value from ${ns} WHERE
                    key = $1 AND (
                        expires_at > TO_TIMESTAMP($2)
                        OR
                        expires_at IS NULL
                    )
            `, [key, Math.floor(Date.now() / 1000)]);

            const value: object | undefined = res?.rows?.[0]?.value;
            if (value == undefined) {
                throw new StorageErrorNotFound(ns, key);
            }
            return value;
        } catch (e: any) {
            if (e instanceof StorageErrorNotFound) {
                throw e;
            } else {
                throw new StorageProviderError(ns, key, e);
            }
        } finally {
            client?.release();
        }
    }

    public async get_multi(ns: string, keys: Array<string>): Promise<Array<object | null>> {
        ns = this._get_ns(ns);
        if (this._ns_init[ns] == undefined) {
            throw new StorageProviderError(ns, new Error('namespace_not_found'));
        }
        await this._ns_init[ns];

        let client: Pgsql.PoolClient | undefined = undefined;

        try {
            client = await this._db.connect();

            const params: Array<string | number> = [Math.floor(Date.now() / 1000)]
            params.push(...keys);

            const res = await client.query<TableLayout>(`
                SELECT key,value from ${ns} WHERE
                    (expires_at > TO_TIMESTAMP($1) OR expires_at IS NULL) AND
                    key IN (${Array.from({ length: keys.length }, (_, i) => `$${i + 2}`).join(',')})
            `, params);

            const kv = res?.rows?.reduce((acc, curr) => {
                if (curr.key != undefined && curr.value != undefined) {
                    acc[curr.key] = curr.value;
                }
                return acc;
            }, {} as { [key: string]: object });

            return keys.map((key) => kv[key] || null);
        } catch (e: any) {
            throw new StorageProviderError(ns, e);
        } finally {
            client?.release();
        }
    }

    public async get_and_set(ns: string, key: string): Promise<AtomicValue> {
        ns = this._get_ns(ns);
        if (this._ns_init[ns] == undefined) {
            throw new StorageProviderError(ns, key, new Error('namespace_not_found'));
        }
        await this._ns_init[ns];

        let client: Pgsql.PoolClient | undefined = undefined;
        try {
            client = await this._db.connect();

            await client.query('BEGIN;');
            const res = await client.query<TableLayout>(`
                SELECT value from ${ns} WHERE
                    key = $1 AND (
                        expires_at > TO_TIMESTAMP($2)
                        OR
                        expires_at IS NULL
                    )
                FOR UPDATE;
            `, [key, Math.floor(Date.now() / 1000)]);

            if (res?.rowCount != 1) {
                throw new StorageErrorNotFound(ns, key);
            }

            const release = async (newValue?: string, newTtl?: number): Promise<true> => {
                try {
                    if (newValue) {
                        await client?.query(`
                            UPDATE ${ns} SET value = $1 WHERE key = $2
                        `, [newValue, key]);
                    }
                    if (newTtl) {
                        const expires = Math.floor(Date.now() / 1000) + newTtl;
                        await client?.query(`
                            UPDATE ${ns} SET expires_at = $1 WHERE key = $2
                        `, [expires, key]);
                    }
                    await client?.query('COMMIT;');
                } catch (e: any) {
                    throw new StorageProviderError(ns, key, e);
                } finally {
                    client?.release();
                }
                return true;
            };
            return {
                value: res?.rows?.[0]?.value != undefined ? res.rows[0].value : null,
                release,
            }
        } catch (e: any) {
            if (e instanceof StorageErrorNotFound) {
                throw e;
            } else {
                throw new StorageProviderError(ns, key, e);
            }
        }
    }

    public async delete(ns: string, key: string): Promise<true> {
        ns = this._get_ns(ns);
        if (this._ns_init[ns] == undefined) {
            throw new StorageProviderError(ns, key, new Error('namespace_not_found'));
        }
        await this._ns_init[ns];

        let client: Pgsql.PoolClient | undefined = undefined;
        try {
            client = await this._db.connect();
            const res = await client.query(`
                DELETE FROM ${ns} WHERE key = $1
            `, [key]);
            if (res?.rowCount == 0) {
                throw new StorageErrorNotFound(ns, key);
            }
            return true;
        } catch (e: any) {
            if (e instanceof StorageErrorNotFound) {
                throw e;
            } else {
                throw new StorageProviderError(ns, key, e);
            }
        } finally {
            client?.release();
        }
    }

    public async list(ns: string, cursor: string | undefined, count: number): Promise<StorageProviderListResult> {
        ns = this._get_ns(ns);
        if (this._ns_init[ns] == undefined) {
            throw new StorageProviderError(ns, new Error('namespace_not_found'));
        }
        await this._ns_init[ns];

        cursor ??= '';
        try {
            const res = await this._db.query(`
                SELECT key FROM ${ns}
                    WHERE
                        (expires_at > TO_TIMESTAMP($3) OR expires_at IS NULL)
                        AND
                        key > $1
                    ORDER BY key
                    LIMIT $2
            `, [cursor, count, Math.floor(Date.now() / 1000)]);

            const data = res?.rows?.map(({key}) => key);
            return {
                cursor: data.length > 0 ? data[data.length-1] : null,
                keys: data,
            }
        } catch (e: any) {
            throw new StorageProviderError(ns, e);
        }
    }
}