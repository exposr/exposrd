
export interface ProviderLock {
    active: () => boolean;
    unlock: () => Promise<void>;
}

export default abstract class LockProvider {
    public abstract lock(resource: string): Promise<ProviderLock | null>;
    public abstract destroy(): Promise<void>;
}