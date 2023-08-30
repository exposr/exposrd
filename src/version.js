import child_process from 'child_process';
import {
    BUILD_DATE,
    BUILD_GIT_BRANCH,
    BUILD_GIT_COMMIT,
    BUILD_MACHINE,
    BUILD_USER,
    BUILD_VERSION,
} from '../build.js';

import package_json from '../package.json' assert { type: "json" };

class Version {

    static useragent = `exposr-cli/${Version.getVersion().version}`;

    static version = Version.getVersion();

    static getVersion() {

        const gitVersion = Version.gitVersion();
        const packageVersion = Version.packageVersion();
        const buildVersion = BUILD_VERSION;

        const build = {
            branch: BUILD_GIT_BRANCH,
            commit: BUILD_GIT_COMMIT,
            date: BUILD_DATE, 
            user: BUILD_USER, 
            machine: BUILD_MACHINE, 
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
            const obj = child_process.spawnSync("git", ["describe", "--tags", "--always", "--dirty"]);
            if (!obj.error && obj.stdout) {
                return obj.stdout.toString('utf-8').trim();
            }
        } catch (e) {}
        return undefined;
    }

    static packageVersion() {
        return package_json?.version;
    }

}

export default Version;