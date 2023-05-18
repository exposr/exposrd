import { Logger } from '../logger.js';
import StorageProvider from './storage-provider.js';
import Pgsql from 'pg';

class PgsqlStorageProvider extends StorageProvider {
    constructor(opts) {
        super();
        this.logger = Logger("pgsql-storage");
        this.expiryCleanInterval = 5 * 60 * 1000;
        this._ns_init = {};

        const url = typeof opts.pgsql.url == 'string' ? new URL(opts.pgsql.url) : opts.pgsql.url;
        const poolSize = opts.pgsql.poolSize || 10;

        this._db = new Pgsql.Pool({
            connectionString: url.href,
            max: poolSize,
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

    async destroy() {
        Object.keys(this._ns_init).forEach((ns) => {
            clearInterval(this._ns_init[ns].expiryTimer);
            delete this._ns_init[ns];
        });
        this._ns_init = {};
        await this._db.end();
        return true;
    }

    _get_ns(ns) {
        ns = ns.replace(/-/g, "_").toLowerCase();
        return isNaN(ns[0]) ? ns : 't_' + ns;
    }

    async init(ns) {
        ns = this._get_ns(ns);

        this._ns_init[ns] ??= new Promise(async (resolve) => {
            const client = await this._db.connect()
            try {
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
            } catch (e) {
                this.logger.error({
                    message: `failed to create table '${ns}': ${e.message}`
                });
                throw e;
            } finally {
                client?.release();
            }

            const cleanExpired = async () => {
                let expiryClient;
                try {
                    expiryClient = await this._db.connect();
                    await expiryClient.query(`
                        DELETE FROM ${ns} WHERE expires_at < TO_TIMESTAMP($1) AND expires_at IS NOT NULL
                    `, [Math.floor(Date.now() / 1000)]);
                } catch (e) {
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

        return this._ns_init[ns];
    }

    async get(ns, key, opts) {
        await this.init(ns);
        ns = this._get_ns(ns);

        let client;
        try {
            client = await this._db.connect();
            if (opts.EX) {
                await client.query('BEGIN;');
                const res = await client.query(`
                    SELECT value from ${ns} WHERE
                        key = $1 AND (
                            expires_at > TO_TIMESTAMP($2)
                            OR
                            expires_at IS NULL
                        )
                    FOR UPDATE;
                `, [key, Math.floor(Date.now() / 1000)]);
                if (res?.rowCount != 1) {
                    return [null, undefined];
                }
                const done = async (value) => {
                    try {
                        if (value) {
                            await client.query(`
                                UPDATE ${ns} SET value = $1 WHERE key = $2
                            `, [value, key]);
                        }
                        await client.query('COMMIT;');
                    } catch (e) {
                        this.logger.error({
                            message: `failed to get update ${key} in ${ns}: ${e.message}`
                        });
                        return false;
                    } finally {
                        client.release();
                    }
                    return true;
                };
                return [res?.rows?.[0]?.value, done];
            } else {
                const res = await client.query(`
                    SELECT value from ${ns} WHERE
                        key = $1 AND (
                            expires_at > TO_TIMESTAMP($2)
                            OR
                            expires_at IS NULL
                        )
                `, [key, Math.floor(Date.now() / 1000)]);
                return res?.rows?.[0]?.value || null;
            }
        } catch (e) {
            this.logger.error({
                message: `failed to get key ${key} from ${ns}: ${e.message}`
            });
            return false;
        } finally {
            if (!opts.EX) {
                client?.release();
            }
        }
    };

    async mget(ns, keys) {
        ns = this._get_ns(ns);

        let client;
        try {
            client = await this._db.connect();
            const res = await client.query(`
                SELECT key,value from ${ns} WHERE
                    (expires_at > TO_TIMESTAMP($1) OR expires_at IS NULL) AND
                    key IN (${Array.from({ length: keys.length }, (_, i) => `$${i + 2}`).join(',')})
            `, [Math.floor(Date.now() / 1000)].concat(keys));

            const kv = res?.rows?.reduce((acc, curr) => {
                acc[curr.key] = curr.value;
                return acc;
            }, {});

            return keys.map((key) => kv[key] || null);
        } catch (e) {
            this.logger.error({
                message: `failed to get keys ${keys} from ${ns}: ${e.message}`
            });
            return false;
        } finally {
            client?.release();
        }
    }

    async set(ns, key, data, opts = {}) {
        await this.init(ns);
        ns = this._get_ns(ns);

        let result;
        let client;
        try {
            client = await this._db.connect();

            let expires = undefined;
            if (typeof opts.TTL == 'number') {
                expires = Math.floor(Date.now() / 1000) + opts.TTL;
            }

            let query;
            if (opts.NX == true) {
                query = {
                    text: `INSERT INTO ${ns} (key, value, modified_at, expires_at) VALUES ($1, $2, NOW(), TO_TIMESTAMP($3))
                        ON CONFLICT(key) DO NOTHING;`
                };
            } else {
                query = {
                    text: `INSERT INTO ${ns} (key, value, modified_at, expires_at) VALUES ($1, $2, NOW(), TO_TIMESTAMP($3))
                        ON CONFLICT(key) DO UPDATE SET
                            value=excluded.value,
                            modified_at=excluded.modified_at,
                            expires_at=excluded.expires_at;`
                };
            }

            const res = await client.query(query, [key, data, expires])
            result = res?.rowCount == 1 ? data : false;
        } catch (e) {
            this.logger.error({
                message: `failed to set key ${key} from ${ns}: ${e.message}`
            });
            result = false;
        } finally {
            client?.release();
        }

        return result;
    };

    async delete(ns, key) {
        ns = this._get_ns(ns);

        let client;
        try {
            client = await this._db.connect();

            const res = await client.query(`
                DELETE FROM ${ns} WHERE key = $1
            `, [key]);
            return res?.rowCount == 1;
        } catch (e) {
            this.logger.error({
                message: `failed to get key ${key} from ${ns}: ${e.message}`
            });
            return false;
        } finally {
            client?.release();
        }
    };

    async list(ns, cursor, count = 10) {
        ns = this._get_ns(ns);

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
                data,
            }
        } catch (e) {
            this.logger.error({
                message: `failed to list keys from ${ns}: ${e.message}`
            });
            return false;
        }
    }

}

export default PgsqlStorageProvider;