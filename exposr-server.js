process.env.NODE_ENV = process.pkg ? 'production' : (process.env.NODE_ENV ?? 'production');
import ExposrServer from './src/index.js';

(async () => {
    const terminate = await ExposrServer();

    const sigHandler = async (signal) => {
        const graceful = await terminate();
        process.exit(graceful ? 0 : -1);
    };

    process.once('SIGTERM', sigHandler);
    process.once('SIGINT', sigHandler);
})();