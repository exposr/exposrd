
type ListenerPending = (err?: Error) => void;

export default class Listener<T extends ListenerBase> {
    private static instances: Map<number, Listener<ListenerBase>> = new Map();

    public static acquire<T extends ListenerBase>(type: { new(port:number): T}, port: number): T {
      if (this.instances.has(port)) {
        const instance = this.instances.get(port) as T;
        instance.acquire();
        return instance;
      } else {
        const instance = new type(port);
        this.instances.set(port, instance as ListenerBase);
        return instance;
      }
    }

    public static async release<T extends ListenerBase>(port: number): Promise<void> {
        const instance = this.instances.get(port) as T;
        if (!instance) {
            return;
        }
        const release = await instance["destroy"]();
        if (release) {
            this.instances.delete(port);
        }
    }
}

export abstract class ListenerBase {
    private _ref: number;
    private _listen_ref: number;
    private _listening: boolean;
    private _pending: Array<ListenerPending> | undefined;
    private _destroyed: boolean;
    public readonly port: number;

    constructor(port: number) {
        this.port = port;
        this._ref = 1;
        this._listen_ref = 0;
        this._listening = false;
        this._pending = undefined;
        this._destroyed = false;
    }

    public getPort(): number {
        return this.port;
    }

    public acquire(): void {
        this._ref++;
    }

    protected abstract _listen(): Promise<void>;

    protected abstract _destroy(): Promise<void>;

    protected abstract _close(): Promise<void>;

    public async listen(): Promise<void> {
        this._listen_ref++;
        if (this._listening) {
            return;
        }

        if (this._pending != undefined) {
            return new Promise((resolve, reject) => {
                const pending = (_err?: Error) => {
                    _err ? reject(_err) : resolve();
                };
                this._pending!.push(pending);
            })
        }

        return new Promise(async (resolve, reject) => {
            this._listening = false;
            this._pending = [];

            let err: Error | undefined = undefined;
            try {
                await this._listen();
                this._listening = true;
            } catch (e: any) {
                err = e;
            }

            this._pending.push((_err) => {
                _err ? reject(_err) : resolve();
            });

            this._pending.map((fn) => fn(err));
            this._pending = undefined;
        });
    }

    public async close(): Promise<void> {
        if (!this._listening) {
            return;
        }
        if (--this._listen_ref == 0) {
            await this._close();
            this._listening = false;
        }
    }

    protected async destroy(): Promise<boolean> {
        if (this._destroyed) {
            return false;
        }
        if (--this._ref == 0) {
            this._destroyed = true;
            await this._close();
            this._listen_ref = 0;
            this._listening = false;
            await this._destroy();
            return true;
        }
        return false;
    }
}