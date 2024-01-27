import assert from 'assert/strict';

export type AtomicValue = {
    value: string | object | null,
    release: (newValue?: string, newTTL?: number) => Promise<true>,
} 

export type StorageProviderListResult = {
    keys: Array<string>,
    cursor: string | null,
}

export type StorageProviderOpts = {
    url: URL,
    callback: (err?: Error) => void;
}

export default abstract class StorageProvider {

    public async init(ns: string): Promise<void> {
        await this._init(ns);
    }

    public async destroy(): Promise<void> {
        await this._destroy();
    }

    protected compound_key(ns: string, key: string): string;
    protected compound_key(ns: string, key: Array<string>): Array<string>;
    protected compound_key(ns: string, key: string | Array<string>): string | Array<string> {
        assert(key !== undefined);
        assert(ns !== undefined);
        if (key instanceof Array) {
            return key.map((k) => `${ns}:${k}`);
        } else {
            return `${ns}:${key}`;
        }
    }

    protected key_only(ns: string, key: string): string {
        return key.slice(key.indexOf(ns) + ns.length + 1);
    }

    protected abstract _destroy(): Promise<void>;
    protected abstract _init(ns: string): Promise<void>;

    /**
     * Set a key, if not already exists
     *
     * @param ns Namespace
     * @param key Key to set
     * @param value Serialized json value to set 
     * @param ttl Time to live in seconds, key will be deleted after this time
     * @throws {StorageErrorAlreadyExists} If key already exists
     * @throws {StorageProviderError} If failure of the underlying storage provider
     * @returns {Promise<boolean>} Returns true if set successfully, false if key already exists
     */
    public abstract set(ns: string, key: string, value: string, ttl?: number): Promise<boolean>;

    /**
     * Put a key, will overwrite existing value if already exists
     *
     * @param ns Namespace
     * @param key Key to set
     * @param value Serialized json value to set
     * @param ttl Time to live in seconds, key will be deleted after this time
     * @throws {StorageProviderError} If failure of the underlying storage provider
     * @returns {Promise<true>} Returns true if set successfully.
     */
    public abstract put(ns: string, key: string, value: string, ttl?: number): Promise<true>;

    /**
     * Read the value for a key.
     *
     * @param ns Namespace
     * @param key Key to read
     * @throws {StorageErrorNotFound} If not found
     * @throws {StorageProviderError} On failure of the underlying storage provider
     * @returns {Promise<string>} Returns serialized json, or an deserialized object.
     */
    public abstract get(ns: string, key: string): Promise<string | object>;

    /**
     * Read multiple keys at once
     *
     * @param ns Namespace
     * @param keys Keys to read
     * @throws {StorageProviderError} If failure of the underlying storage provider
     * @returns {Promise<Array<string | null>} Returns array of serialized json, or deserialized objects.
     */
    public abstract get_multi(ns: string, keys: Array<string>): Promise<Array<string | object | null>>;

    /**
     * Atomically get and set a key.
     *
     * Will take an exclusive lock on the key, return the value as an AtomicValue.
     * When done, the key must be released, with an optional new value.
     *
     * @param ns Namespace
     * @param key Key to get and set
     * @throws {StorageErrorNotFound} If not found
     * @throws {StorageProviderError} On failure of the underlying storage provider
     * @returns {Promise<AtomicValue>} Returns an atomic value.
     */
    public abstract get_and_set(ns: string, key: string): Promise<AtomicValue>;

    /**
     * Delete a key
     *
     * @param ns Namespace
     * @param key Key to delete
     * @throws {StorageErrorNotFound} If not found
     * @throws {StorageProviderError} On failure of the underlying storage provider
     * @returns {Promise<true>} Returns true if deleted successfully.
     */
    public abstract delete(ns: string, key: string): Promise<true>;

    /**
     * List keys in a namespace
     *
     * @param ns Namespace
     * @param cursor Cursor to continue from, or undefined to start from first key
     * @param count Number of results to return
     * @throws {StorageProviderError} On failure of the underlying storage provider
     * @returns {Promise<StorageProviderListResult>} Returns a list of keys.
     */
    public abstract list(ns: string, cursor: string | undefined, count: number): Promise<StorageProviderListResult>;
}

export class StorageErrorNotFound implements Error {
    public readonly name: string = "storage_error_not_found";
    public message: string;
    public stack?: string;
    public ns: string;
    public key: string;

    constructor(ns: string, key: string) {
        this.ns = ns;
        this.key = key;
        this.message = `Key ${ns}:${key} was not found`;
        this.stack = new Error().stack;
    }
}

export class StorageErrorAlreadyExists implements Error {
    public readonly name: string = "storage_error_already_exists";
    public message: string;
    public stack?: string;
    public ns: string;
    public key: string;

    constructor(ns: string, key: string) {
        this.ns = ns;
        this.key = key;
        this.message = `Key ${ns}:${key} already exists`;
        this.stack = new Error().stack;
    }
}

export class StorageProviderError implements Error {
    public readonly name: string = "storage_provider_error";
    public message: string;
    public stack?: string;
    public ns: string;
    public key?: string;
    public inner: Error;

    constructor(ns: string, key: string, inner: Error);
    constructor(ns: string, inner: Error);
    constructor(ns: string, key?: string | Error, inner?: Error) {
        this.ns = ns;
        if (key instanceof Error) {
            inner = key;
            key = undefined
        }
        assert(inner !== undefined);
        this.key = key;
        this.inner = inner;
        if (key) {
            this.message = `Error in storage provider for ${ns}:${key}: ${inner.message}`;
        } else {
            this.message = `Error in storage provider for namespace ${ns}: ${inner.message}`;
        }
        this.stack = inner.stack;
    }
}