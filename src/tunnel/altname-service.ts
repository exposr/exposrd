import dns from 'dns';
import Storage from '../storage/storage.js';
import { Logger } from '../logger.js';
import { Serializable } from '../storage/serializer.js';

class AltName implements Serializable {
    public tunnelId?: string;
    public created_at?: string;

    constructor(tunnelId?: string, created_at?: string) {
        this.tunnelId = tunnelId;
        this.created_at = created_at;
    }
}

class AltNameService {
    private db: Storage;
    private logger: any;

    constructor() {
        this.db = new Storage("ingress-altnames");
        this.logger = Logger("alt-name-service");
    }

    public async destroy(): Promise<void> {
        await this.db.destroy();
    }

    private _key(service: string, altName: string): string {
        return `${service}-${altName}`.toLowerCase();
    }

    private async _set(service: string, altName: string, tunnelId: string): Promise<boolean> {
        const altNameData: AltName = new AltName(tunnelId, new Date().toISOString());
        const key = this._key(service, altName);
        return this.db.set(key, altNameData);
    }

    private async _get(service: string, altName: string): Promise<AltName | undefined>  {
        const res = await this.db.read<AltName>(this._key(service, altName), AltName);
        return res instanceof AltName ? res : undefined;
    }

    private async _del(service: string, altName: string, tunnelId?: string): Promise<boolean> {
        const obj = await this._get(service, altName);
        if (tunnelId === undefined || obj?.tunnelId === tunnelId) {
            return this.db.delete(this._key(service, altName));
        } else {
            return false;
        }
    }

    public async update(service: string, tunnelId: string, add: Array<string> | undefined, remove?: Array<string>): Promise<Array<string>> {
        add ??= []
        remove ??= []

        const adds = add.map((an) => this._set(service, an, tunnelId));
        const dels = remove.map((an) => this._del(service, an, tunnelId));
        await Promise.allSettled([...adds, ...dels]);

        const result = (await Promise.allSettled([...add, ...remove].flatMap(async (an) => {
            const obj = await this._get(service, an);
            return obj?.tunnelId === tunnelId ? an : [];
        }))).flatMap(res => res.status === 'fulfilled' ? res.value : []); 

        this.logger.isTraceEnabled() &&
            this.logger.trace({
                operation: 'update',
                service,
                tunnelId,
                add,
                remove,
                result,
            });
        return result;
    }

    public async get(service: string, altName: string): Promise<string | undefined> {
        const obj = await this._get(service, altName);
        return obj?.tunnelId;
    }

    static async _resolve(domain: string, altName: string): Promise<Array<string>> {
        return new Promise(async (resolve, reject) => {
            try {
                const res = await dns.promises.resolveCname(altName);
                resolve(res.includes(domain) ? [altName]: []);
            } catch (e: any) {
                reject();
            }
        });
    }

    static async resolve(domain: string, altNames: Array<string>): Promise<Array<string>> {
        const resolved = await Promise.allSettled(altNames.flatMap((altName) => {
            return AltNameService._resolve(domain, altName);
        }));
        return [...new Set(resolved
            .flatMap(res => res.status === 'fulfilled' ? res.value : []))];
    }

}

export default AltNameService;