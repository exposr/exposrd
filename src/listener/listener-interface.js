import assert from 'assert/strict';

class ListenerInterface {

    _ref = 0;

    async _listen() {
        assert.fail("_listen not implemented");
    }

    async _destroy() {
        assert.fail("_destroy not implemented");
    }

    async listen() {
        this._ref++;
        if (this._listening) {
            return new Promise((resolve) => { resolve() });
        }

        if (this._pending) {
            return new Promise((resolve, reject) => {
                const pending = (_err) => {
                    _err ? reject(_err) : resolve();
                };
                this._pending.push(pending);
            })
        }

        return new Promise(async (resolve, reject) => {
            this._listening = false;
            this._pending = [];

            let err = undefined;
            try {
                await this._listen();
                this._listening = true;
            } catch (e) {
                err = e;
            }

            this._pending.push((_err) => {
                _err ? reject(_err) : resolve();
            });

            this._pending.map((fn) => fn(err));
            delete this._pending;
        })
    }

    async destroy() {
        if (this._destroyed) {
            return;
        }
        if (--this._ref == 0) {
            this._destroyed = true;
            return this._destroy();
        }
    }
}

export default ListenerInterface;