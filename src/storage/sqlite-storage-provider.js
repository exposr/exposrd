import { Logger } from '../logger.js';
import StorageProvider from './storage-provider.js';
import Sqlite from 'better-sqlite3';

class SqliteStorageProvider extends StorageProvider {
    constructor(opts) {
        super();
        this.logger = Logger("sqlite-storage");

        const db_file = opts.sqlitePath || "db.sqlite";
        this._db = new Sqlite(db_file)
        this._db.pragma('journal_mode = WAL');
        this.expiryCleanInterval = 5 * 60 * 1000;
        this._ns_init = {};
        this.logger.info({
            message: `SQlite storage initialized: ${db_file}`
        });
        typeof opts.callback === 'function' && process.nextTick(opts.callback);
    }

    async destroy() {
        Object.keys(this._ns_init).forEach((ns) => {
            clearInterval(this._ns_init[ns].expiryTimer);
            this._ns_init[ns].cleanExpired();
            delete this._ns_init[ns];
        });
        this._ns_init = {};
        this._db.close();
        return true;
    }

    _get_ns(ns) {
        ns = ns.replace(/-/g, "_").toLowerCase();
        return isNaN(ns[0]) ? ns : 't_' + ns;
    }

    async init(ns) {
        ns = this._get_ns(ns);
        if (this._ns_init[ns]) {
            return true;
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
            } catch (e) {
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

    async get(ns, key) {
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
            const res = stm.get(key, Math.floor(Date.now() / 1000));
            return res?.value || null;
        } catch (e) {
            this.logger.error({
                message: `failed to get key ${key} from ${ns}: ${e.message}`
            });
            return false;
        }
    };

    async mget(ns, keys) {
        ns = this._get_ns(ns);
        try {
            const stm = this._db.prepare(`
                SELECT key,value from ${ns} WHERE
                    key IN (${new Array(keys.length).fill("?").join(',')}) AND
                    (expires_at > ? OR expires_at IS NULL)
            `);

            const res = stm.all(keys, Math.floor(Date.now() / 1000));
            const kv = res.reduce((acc, curr) => {
                acc[curr.key] = curr.value;
                return acc;
            }, {});

            return keys.map((key) => kv[key] || null);
        } catch (e) {
            this.logger.error({
                message: `failed to get keys ${keys} from ${ns}: ${e.message}`
            });
            return false;
        }
    }

    async set(ns, key, data, opts = {}) {
        ns = this._get_ns(ns);

        let expires = undefined;
        if (typeof opts.TTL == 'number') {
            expires = Math.floor(Date.now() / 1000) + opts.TTL;
        }

        try {
            let stm;
            if (opts.NX == true) {
                stm = this._db.prepare(`
                    INSERT INTO ${ns} (key, value, modified_at, expires_at) VALUES (?, ?, unixepoch(), ?)
                        ON CONFLICT(key) DO NOTHING;
                `)
            } else {
                stm = this._db.prepare(`
                    INSERT INTO ${ns} (key, value, modified_at, expires_at) VALUES (?, ?, unixepoch(), ?)
                        ON CONFLICT(key) DO UPDATE SET
                            value=excluded.value,
                            modified_at=excluded.modified_at,
                            expires_at=excluded.expires_at;
                `)
            }

            const res = stm.run(String(key), data, expires);
            return res?.changes == 1 ? data : false;
        } catch (e) {
            this.logger.error({
                message: `failed to set key ${key} from ${ns}: ${e.message}`
            });
            return false;
        }
    };

    async delete(ns, key) {
        ns = this._get_ns(ns);

        try {
            const stm = this._db.prepare(`
                DELETE FROM ${ns} WHERE key = ?
            `)
            const res = stm.run(key);
            return res?.changes == 1;
        } catch (e) {
            this.logger.error({
                message: `failed to get key ${key} from ${ns}: ${e.message}`
            });
            return false;
        }
    };

    async list(ns, cursor, count = 10) {
        ns = this._get_ns(ns);

        cursor ??= '';
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
            const res = stm.all(cursor, count).map(({key}) => key);
            return {
                cursor: res.length > 0 ? res[res.length-1] : null,
                data: res,
            }

        } catch (e) {
            this.logger.error({
                message: `failed to list keys from ${ns}: ${e.message}`
            });
            return false;
        }
    }

}

export default SqliteStorageProvider;