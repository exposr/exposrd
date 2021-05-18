import child_process from 'child_process';
import fs from 'fs';

class Version {

    static version = Version.getVersion();

    static getVersion() {

        const gitVersion = Version.gitVersion();
        const packageVersion = Version.packageVersion();
        const buildVersion = process.env['EXPOSR_BUILD_VERSION'];

        const build = {
            branch: process.env['EXPOSR_BUILD_GIT_BRANCH'],
            commit: process.env['EXPOSR_BUILD_GIT_COMMIT'],
            date: process.env['EXPOSR_BUILD_DATE'],
            user: process.env['EXPOSR_BUILD_USER'],
            machine: process.env['EXPOSR_BUILD_MACHINE'],
        };

        const version = {
            version: buildVersion || gitVersion || packageVersion,
            package: packageVersion,
            build
        }
        Version.version = version;
        return version;
    }

    static gitVersion() {
        try {
            const obj = child_process.spawnSync("git describe --tags --always --dirty");
            if (!obj.error && obj.stdout) {
                return obj.stdout.toString('utf-8').trim();
            }
        } catch (e) {}
        return undefined;
    }

    static packageVersion() {
        const data = fs.readFileSync(new URL('../package.json', import.meta.url));
        const pkg = JSON.parse(data);
        return pkg.version;
    }

}

export default Version;