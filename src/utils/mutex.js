class Mutex {
    constructor() {
        this._locked = false;
        this._pending = [];
        this._index = 0;
    }

    async acquire(cancelSignal) {

        return new Promise((resolve, reject) => {
            const index = this._index++;

            if (cancelSignal?.aborted == true) {
                return reject(false);
            }

            if (!this._locked) {
                this._locked = true;
                return resolve(true);
            }

            const handler = () => {
                cancelSignal?.removeEventListener('abort', handler);
                if (cancelSignal?.aborted == true) {
                    this._pending = this._pending.filter((obj) => obj.index != index);
                    reject(false);
                } else {
                    this._locked = true;
                    resolve(true);
                }
            };

            if (cancelSignal) {
                cancelSignal.addEventListener('abort', handler, { once: true });
            }
            this._pending.push({
                index,
                acquire: () => {
                    handler();
                }
            });
        });
    }

    release() {
        if (this._pending.length > 0) {
            const {_, acquire} = this._pending.shift();
            acquire();
        } else {
            this._locked = false;
        }
    }
}

export default Mutex;