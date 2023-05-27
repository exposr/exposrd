import assert from 'assert/strict';
import Config from '../../../src/config.js';

describe('configuration parser', () => {

    it('--redis-url backwards compatibility', () => {
        const config = new Config([
            "--redis-url", "redis://redis"
        ]);

        assert(config._config['cluster'] == 'redis', `cluster not set to redis, ${config._config['cluster']}`);
        assert(config._config['cluster-redis-url'] == 'redis://redis', `cluster url not set, ${config._config['cluster-redis-url']}`);
        assert(config._config['storage-url'] == 'redis://redis', `storage url not set, ${config._config['storage-url']}`);

        config.destroy();
    });

    it('--cluster auto defaults to single-node', () => {
        const config = new Config([
            "--cluster", "auto"
        ]);

        assert(config._config['cluster'] == 'single-node', `cluster not set to single-node, got ${config._config['cluster']}`);
        config.destroy();
    });

    it('--cluster auto returns udp w/ --storage-url redis', () => {
        const config = new Config([
            "--cluster", "auto",
            "--storage-url", "redis://redis",
        ]);

        assert(config._config['cluster'] == 'udp', `cluster not set to udp, ${config._config['cluster']}`);
        config.destroy();
    });

    it('--cluster redis requires --cluster-redis-url', () => {
        const config = new Config([
            "--ingress-http-domain", "http://example.com",
            "--cluster", "redis"
        ]);
    
        assert(config._error.message == "Missing required argument: cluster-redis-url", "argument not required");
    
        config.destroy();
    });
});