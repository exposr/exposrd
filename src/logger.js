import Log4js from 'log4js';
import Config from './config.js';

Log4js.addLayout('json', function(config) {
    return function(logEvent) {
        const data = typeof logEvent.data[0] == 'string' ? {
            message: logEvent.data[0]
        } : logEvent.data[0];
        const logEntry = {
            timestamp: logEvent.startTime,
            data,
            ...logEvent.context,
            level: logEvent.level.levelStr,
            logger: logEvent.categoryName,
            pid: logEvent.pid,
        }
        return JSON.stringify(logEntry, undefined, 0);
    }
});

class LoggerFactory {
    constructor(namespace) {
        const logger = this._logger = Log4js.getLogger(namespace);

        Log4js.configure({
            appenders: {
              out: { type: 'stdout', layout: { type: Config.get('log-format'), separator: ',' } }
            },
            categories: {
              default: { appenders: ['out'], level: Config.get("log-level") }
            }
        });

        logger.level = Config.get("log-level");

        logger.withContext = (key, value) => {
            logger.addContext(key, value);

            const logfn = (orig, fn, ...args) => {
                logger[fn] = orig;
                logger[fn](...args)
                logger.removeContext(key, value);
            };

            ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].forEach(fn => {
                const orig = logger[fn];
                logger[fn] = (...args) => { return logfn(orig, fn, ...args); }
            });

            return logger;
        }

        return logger;
    }
}

export function Logger(ns) { return new LoggerFactory(ns); };
export default new LoggerFactory();