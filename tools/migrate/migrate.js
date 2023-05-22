process.env.EXPOSR_EMBEDDED = 'true';

import yargs from 'yargs';
import PgsqlStorageProvider from '../../src/storage/pgsql-storage-provider.js';
import RedisStorageProvider from '../../src/storage/redis-storage-provider.js';
import SqliteStorageProvider from '../../src/storage/sqlite-storage-provider.js';

const parse = (argv) => {
    return yargs()
        .version(false)
        .usage('Usage: $0 <source-url> <destination-url> [--dry-run]')
        .positional('source-url', {
            describe: 'Source storage',
            type: 'string',
        })
        .positional('destination-url', {
            describe: 'Destination storage',
            type: 'string',
        })
        .option('dry-run', {
            describe: 'Do not write to destination',
            default: false,
            type: 'boolean'
        })
        .option('namespace', {
            describe: 'Namespaces to migrate',
            default: ['tunnel', 'account', 'ingress-altnames'],
            type: 'array'
        })
        .check((args) => {
            args._[0] = new URL(args._[0]);
            args._[1] = new URL(args._[1]);
            return true;
        })
        .example('$0 redis://localhost:6379 postgres://localhost:5432', 'Copy from redis to postgres')
        .example('$0 sqlite://db.sqlite postgres://localhost:5432', 'Copy from sqlite to postgres')
        .demandCommand(2, "Both a source and destination is required")
        .wrap(120)
        .parse(argv);
};

const createStorage = async (url) => {
    const type = url.protocol.slice(0, -1) || 'none';

    let clazz;
    let opts;
    switch (type) {
        case 'redis':
            clazz = RedisStorageProvider;
            opts = {
                redisUrl: url
            }
            break;
        case 'sqlite':
            clazz = SqliteStorageProvider;
            opts = {
                sqlitePath: url.href.slice(url.protocol.length + 2)
            }
            break;
        case 'pgsql':
        case 'postgres':
            clazz = PgsqlStorageProvider;
            opts = {
                pgsql: {
                    url
                }
            }
            break;
        default:
            console.log(`Unsupported storage ${type}`);
            process.exit(-1);
    }

    return new Promise((resolve, reject) => {
        const storage = new clazz({
            ...opts,
            callback: (err) => { err ? reject(err) : resolve(storage) },
        });
    });
};

const migrateNamespace = async (source, destination, namespace, dryRun) => {
    console.log(`Migrating namespace '${namespace}'`);
    let count = 0;
    let total_success = 0;
    let total_failed = 0;

    await source.init(namespace);
    await destination.init(namespace);

    let res;
    while (true) {
        res = await source.list(namespace, res?.cursor, 100);
        if (!res) {
            break;
        }

        const keys = res.data;
        if (keys.length <= 0) {
            break;
        }

        count += keys.length;
        console.log(`Processing records ${count - 100}...${count}`);

        const values = await source.mget(namespace, keys);

        const setter = values.map((value, index) => {
            if (value && !dryRun) {
                return destination.set(namespace, keys[index], value);
            } else {
                return new Promise((resolve) => { resolve() });
            }
        });

        const [processed_success, processed_failed] = await Promise.allSettled(setter).then((results) => {
            const success = results.filter((result) => result.status == 'fulfilled');
            const failed = results.filter((result) => result.status == 'rejected');
            return [success, failed];
        });

        total_success += processed_success.length;
        total_failed += processed_failed.length;
        if (processed_failed.length > 0) {
            console.error(`${processed_failed.length} of ${keys.length} records failed to synchronize`);
        }

        if (res.cursor == null) {
            break;
        }
    }

    let total_removed = 0;
    count = 0;
    while (true) {
        res = await destination.list(namespace, res?.cursor, 100);
        if (!res) {
            break;
        }

        const keys = res.data;
        if (keys.length <= 0) {
            break;
        }

        count += keys.length;
        console.log(`Verifying records ${count - 100}...${count}`);

        const values = await source.mget(namespace, keys);

        const setter = values.map((value, index) => {
            if (!value && !dryRun) {
                return destination.delete(namespace, keys[index]);
            } else {
                return new Promise((resolve) => { resolve(null) });
            }
        });

        const removed = await Promise.allSettled(setter).then((results) => {
            return results.filter((result) => result.value != null);
        });
        total_removed += removed.length;

        if (removed.length > 0) {
            console.log(`Removed ${removed.length} stale entries from destination`);
        }

        if (res.cursor == null) {
            break;
        }
    }

    console.log(`Completed namespace '${namespace}', successful records=${total_success}, failed records=${total_failed}`);
};

const migrate = async (srcUrl, dstUrl, dryRun, namespaces) => {
    const source = await createStorage(srcUrl);
    console.log(`Source ${srcUrl} open`);
    const destination = await createStorage(dstUrl);
    console.log(`Destination ${dstUrl} open`);

    for (let i = 0; i < namespaces.length; i++) {
        const namespace = namespaces[i];
        await migrateNamespace(source, destination, namespace, dryRun);
    }

    source.destroy();
    destination.destroy();
};

(async () => {
    const args = parse(process.argv.slice(2));
    await migrate(args._[0], args._[1], args['dry-run'], args['namespace']);
})();