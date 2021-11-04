import dns from 'dns';
import Storage from '../storage/index.js';
import { Logger } from '../logger.js';

const logger = Logger("alt-name-service");

class AltNameService {
    constructor() {
        this.db = new Storage("ingress-altnames");
    }

    async destroy() {
        return this.db.destroy();
    }

    _key(service, altName) {
        return `${service}-${altName}`.toLowerCase();
    }

    async _set(service, altName, tunnelId) {
        return this.db.set(this._key(service, altName), {
            tunnelId,
            created_at: new Date().toISOString(),
        }, { NX: true });
    }

    async _get(service, altName) {
        return this.db.get(this._key(service, altName));
    }

    async _del(service, altName, tunnelId = undefined) {
        const obj = await this._get(service, altName);
        if (tunnelId === undefined || obj?.tunnelId === tunnelId) {
            return this.db.delete(this._key(service, altName));
        } else {
            return false;
        }
    }

    async update(service, tunnelId, add, remove) {
        add ??= []
        remove ??= []

        const adds = add.map((an) => this._set(service, an, tunnelId));
        const dels = remove.map((an) => this._del(service, an, tunnelId));
        await Promise.allSettled([...adds, ...dels]);

        const result = (await Promise.allSettled([...add, ...remove].flatMap(async (an) => {
            const obj = await this._get(service, an);
            return obj?.tunnelId === tunnelId ? an : [];
        }))).flatMap(({_, value}) => value);

        logger.isTraceEnabled() &&
            logger.trace({
                operation: 'update',
                service,
                tunnelId,
                add,
                remove,
                result,
            });
        return result;
    }

    async get(service, altName) {
        const obj = await this._get(service, altName);
        return obj?.tunnelId;
    }

    static async _resolve(domain, altName) {
        return new Promise(async (resolve, reject) => {
            try {
                const res = await dns.promises.resolveCname(altName);
                resolve(res.includes(domain) ? [altName]: []);
            } catch (e) {
                reject();
            }
        });
    }

    static async resolve(domain, altNames) {
        const resolved = await Promise.allSettled(altNames.flatMap((altName) => {
            return AltNameService._resolve(domain, altName);
        }));
        return [...new Set(resolved
            .filter(({status, _}) => status == 'fulfilled')
            .flatMap(({_, value}) => value))];
    }

}

export default AltNameService;