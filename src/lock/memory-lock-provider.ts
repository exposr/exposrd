import Mutex from "../utils/mutex.js";
import LockProvider, { ProviderLock } from "./lock-provider.js";

class MemoryLockProvider implements LockProvider {
    private _locks: { [key: string]: Mutex };
    private _abort: AbortController;

    constructor() {
        this._locks = {};
        this._abort = new AbortController();
    }

    public async lock(resource: string): Promise<ProviderLock | null> {
        this._locks[resource] ??= new Mutex();
        const mutex = this._locks[resource];

        try {
            const locked = await mutex.acquire(this._abort.signal);
            if (!locked) {
                return null;
            }
            return {
                active: () => { return true },
                unlock: async () => {
                    mutex.release();
                    if (!mutex.locked()) {
                        delete this._locks[resource];
                    }
                }
            }
        } catch (e: any) {
            delete this._locks[resource];
            return null
        }
    }

    public async destroy(): Promise<void> {
        this._abort.abort();
        this._locks = {};
    }
}

export default MemoryLockProvider;