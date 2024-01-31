import assert from 'assert/strict';
import StorageManager from '../../../src/storage/storage-manager.js';
import AltNameService from '../../../src/tunnel/altname-service.js';

describe('altname service', () => {
    let altNameService: AltNameService;

    beforeEach(async () => {
        await StorageManager.init(new URL("memory://"));
        altNameService = new AltNameService();
    });

    afterEach(async () => {
        await altNameService.destroy();
        await StorageManager.close();
    })

    it(`can add altname`, async () => {
        const altnames = await altNameService.update("test", "tunnel1", ["altname1"]);
        assert(altnames.length === 1);
        assert(altnames[0] === "altname1");
    });

    it(`can add and remove altname`, async () => {
        let altnames = await altNameService.update("test", "tunnel1", ["altname1"]);
        assert(altnames.length === 1);
        assert(altnames[0] === "altname1");

        altnames = await altNameService.update("test", "tunnel1", [], ["altname1"]);
        assert(altnames.length === 0);
    });

    it(`same alt name is not duplicated`, async () => {
        let altnames = await altNameService.update("test", "tunnel1", ["altname1"]);
        assert(altnames.length === 1);
        assert(altnames[0] === "altname1");

        altnames = await altNameService.update("test", "tunnel1", ["altname1"]);
        assert(altnames.length === 1);
        assert(altnames[0] === "altname1");
    });

    it(`adding the same alt name to different tunnels`, async () => {
        let altnames = await altNameService.update("test", "tunnel1", ["altname1"]);
        assert(altnames.length === 1);
        assert(altnames[0] === "altname1");

        altnames = await altNameService.update("test", "tunnel2", ["altname1"]);
        assert(altnames.length === 0);

        const tunnelId = await altNameService.get("test", "altname1")
        assert(tunnelId === "tunnel1");
    });

    it(`update can add and remove`, async () => {
        let altnames = await altNameService.update("test", "tunnel1", ["altname1"]);
        assert(altnames.length === 1);
        assert(altnames[0] === "altname1");

        altnames = await altNameService.update("test", "tunnel1", ["altname1"], ["altname2"]);
        assert(altnames.length === 1);
        assert(altnames[0] === "altname1");
    });

    it(`can have multiple altname`, async () => {
        const altnames = await altNameService.update("test", "tunnel1", ["altname1", "altname2"]);
        assert(altnames.length === 2);
        assert(altnames[0] === "altname1");
        assert(altnames[1] === "altname2");
    });

    it(`supports different altname services`, async () => {
        let altnames = await altNameService.update("test", "tunnel1", ["altname1"]);
        assert(altnames.length === 1);
        assert(altnames[0] === "altname1");

        let tunnelId = await altNameService.get("test", "altname1")
        assert(tunnelId === "tunnel1");

        altnames = await altNameService.update("test2", "tunnel2", ["altname1"]);
        assert(altnames.length === 1);
        assert(altnames[0] === "altname1");

        tunnelId = await altNameService.get("test2", "altname1")
        assert(tunnelId === "tunnel2");
    });
});