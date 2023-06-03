process.env.NODE_ENV = process.pkg ? 'production' : (process.env.NODE_ENV ?? 'production');
import ExposrServer from './src/index.js';
import selfTest from './src/self-test.js';

(async () => {
    if (process.env.EXPOSR_SELF_TEST) {
        const result = await selfTest();
        console.log('All tests:', result ? 'PASS' : 'FAIL');
        process.exit(result ? 0 : -1);
    }
    const terminate = await ExposrServer();

    const sigHandler = async (signal) => {
        const graceful = await terminate(signal, {gracefulTimeout: undefined, drainTimeout: undefined});
        process.exit(graceful ? 0 : -1);
    };

    process.once('SIGTERM', sigHandler);
    process.once('SIGINT', sigHandler);
})();