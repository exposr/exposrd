process.env.NODE_ENV = process.pkg ? 'production' : (process.env.NODE_ENV ?? 'production');
import ExposrServer from './src/index.js';
ExposrServer();