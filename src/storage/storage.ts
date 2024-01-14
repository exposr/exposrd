import { Logger } from "../logger.js";
import Serializer, { Serializable } from "./serializer.js";
import StorageManager from "./storage-manager.js";
import StorageProvider, { AtomicValue, StorageErrorAlreadyExists, StorageErrorNotFound } from "./storage-provider.js";

type UpdateCallback<T extends Serializable> = (obj: T) => Promise<boolean>;

export interface ListResult extends ListState {
    keys: Array<string>,
    /** Number of additional results already fetched */
    pending: number,
}

export interface ListState {
    cursor: string | null,
}

interface _ListState extends ListResult {
    queue: Array<string>,
};

export default class Storage {
    private logger: any;
    private ns: string;
    private _storage: StorageProvider;

    constructor(namespace: string) {
        this.ns = namespace;
        this.logger = Logger("storage");
        this._storage = StorageManager.getStorage();
        this._storage.init(namespace);
    }

    public async destroy(): Promise<void> {
    }

    public async read<T extends Serializable>(key: string, clazz: { new(): T ;}): Promise<T | null | false>;
    public async read<T extends Serializable>(keys: Array<string>, clazz: { new(): T ;}): Promise<Array<T | null> | null | false>;
    public async read<T extends Serializable>(key: string | Array<string>, clazz: { new(): T ;}): Promise<T | Array<T | null> | null | false> {
        try {
            if (key instanceof Array) {
                const result = await this._storage.get_multi(this.ns, key);
                return result.map((d) => { return d != null ? Serializer.deserialize<T>(d, clazz) : null });
            } else {
                const result = await this._storage.get(this.ns, key);
                return Serializer.deserialize<T>(result, clazz);
            }
        } catch (e: any) {
            if (e instanceof StorageErrorNotFound) {
                return null;
            } else {
                this.logger.error(`Failed to read key ${key} from storage: ${e.message}`);
                return false;
            }
        }
    }

    public async update<T extends Serializable>(key: string, clazz: { new(): T ;}, cb: UpdateCallback<T>): Promise<T | null> {
        let atomicValue: AtomicValue;
        let obj: T;

        try {
            atomicValue = await this._storage.get_and_set(this.ns, key)
            if (!atomicValue.value) {
                obj = new clazz();
            } else {
                obj = Serializer.deserialize<T>(atomicValue.value, clazz);
            }
        } catch (e: any) {
            this.logger.error(`Failed to update key ${key} in storage: ${e.message}`);
            return null;
        }

        let error: Error | undefined = undefined;
        let res: boolean = false;
        try {
            res = await cb(obj);
        } catch (e: any) {
            error = e;
        }

        if (res !== true) {
            await atomicValue.release();
            if (error) {
                throw error;
            }
            return null;
        }

        try {
            const serialized = Serializer.serialize(obj);
            await atomicValue.release(serialized);
        } catch (e: any) {
            this.logger.error(`Failed to update key ${key} in storage: ${e.message}`);
            return null;
        }
        return obj;
    }

    public async create(key: string, obj: Serializable, ttl?: number): Promise<boolean | null> {
        const serialized = Serializer.serialize(obj);

        try {
            const res = await this._storage.set(this.ns, key, serialized, ttl);
            return res;
        } catch (e: any) {
            if (e instanceof StorageErrorAlreadyExists) {
                return false;
            } else {
                this.logger.error(`Failed to create key ${key} in storage: ${e.message}`);
                return null;
            }
        }
    }

    public async put(key: string, obj: Serializable, ttl?: number): Promise<boolean> {
        const serialized = Serializer.serialize(obj);

        try {
            const res = await this._storage.put(this.ns, key, serialized, ttl);
            return res;
        } catch (e: any) {
            this.logger.error(`Failed to put key ${key} in storage: ${e.message}`);
            return false;
        }
    }

    public async delete(key: string): Promise<boolean> {
        try {
            const res = await this._storage.delete(this.ns, key);
            return res;
        } catch (e: any) {
            this.logger.error(`Failed to delete key ${key} in storage: ${e.message}`);
            return false;
        }
    }

    public async set(key: string, value: object, ttl?: number): Promise<boolean> {
        try {
            const serialized = JSON.stringify(value);
            const res = await this._storage.set(this.ns, key, serialized, ttl);
            return res;
        } catch (e: any) {
            this.logger.error(`Failed to set key ${key} in storage: ${e.message}`);
            return false;
        }
    }

    public async get(key: Array<string>): Promise<Array<object | null>>;
    public async get(key: string): Promise<object>;
    public async get(key: any): Promise<false | null | object | Array<object | null>> {
        try {
            if (key instanceof Array) {
                const res = key.length > 0 ? await this._storage.get_multi(this.ns, key) : [];
                return res.map((d) => {
                    return typeof d === 'string' ? JSON.parse(d) : (typeof d === 'object' ? d : null);
                });
            } else {
                const res = await this._storage.get(this.ns, key);
                return typeof res === 'string' ? JSON.parse(res) : (typeof res === 'object' ? res : null);
            }
        } catch (e: any) {
            if (e instanceof StorageErrorNotFound) {
                return null;
            } else {
                this.logger.error(`Failed to get key ${key} from storage: ${e.message}`);
                return false;
            }
        }
    };

    public async list(previousState: ListState | ListResult | undefined, count?: number): Promise<ListResult> {
        count ??= 10;
        let data: Array<string> = [];
        const state = previousState as _ListState;

        if (state && state.queue?.length > 0) {
            const queue = state.queue?.slice(count) ?? [];
            const newState: _ListState = {
                cursor: state.cursor,
                queue,
                keys: state.queue?.slice(0, count) ?? [],
                pending: queue.length,
            };
            return newState
        }

        if (state && state?.cursor == null) {
            const newState: _ListState = {
                cursor: null,
                pending: 0,
                queue: [],
                keys: []
            };
            return newState;
        }

        let cursor: string | undefined | null =
            state?.cursor ? Buffer.from(state.cursor, 'base64url').toString('utf-8') : undefined;
        do {
            const requested = count - data.length;
            const res = await this._storage.list(this.ns, cursor, requested);
            cursor = res.cursor;
            data.push(...res.keys);
        } while (data.length < count && cursor != null);

        const queue = data.slice(count);
        const newState: _ListState = {
            cursor: cursor ? Buffer.from(cursor).toString('base64url') : null,
            queue,
            keys: data.slice(0, count),
            pending: queue.length,
        };
        return newState;
    }
}