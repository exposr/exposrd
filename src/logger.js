import Log4js from 'log4js';
import Config from './config.js';

Log4js.addLayout('json', function(config) {
    return function(logEvent) {
        const logEntry = {
            timestamp: logEvent.startTime,
            data: logEvent.data[0],
            ...logEvent.context,
            level: logEvent.level.levelStr,
            pid: logEvent.pid,
        }
        return JSON.stringify(logEntry, undefined, 0);
    }
});

class LoggerFactory {
    constructor(namespace) {
        const logger = this._logger = Log4js.getLogger("json");
        Log4js.configure({
            appenders: {
              out: { type: 'stdout', layout: { type: 'json', separator: ',' } }
            },
            categories: {
              default: { appenders: ['out'], level: Config.get("log-level") }
            }
        });

        logger.level = Config.get("log-level");
        namespace && logger.addContext("logger", namespace)
        return logger;
    }
}

export function Logger(ns) { return new LoggerFactory(ns); };
export default new LoggerFactory();