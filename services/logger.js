const fs = require('fs');
const path = require('path');

const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const writeLog = (level, message, meta = {}) => {
    const payload = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...meta,
    };
    const line = `${JSON.stringify(payload)}\n`;
    fs.appendFileSync(path.join(logDir, 'app.log'), line);
    const consoleMethod = level === 'error' ? console.error : console.log;
    consoleMethod(`[${level}] ${message}`);
};

module.exports = {
    info: (message, meta) => writeLog('info', message, meta),
    warn: (message, meta) => writeLog('warn', message, meta),
    error: (message, meta) => writeLog('error', message, meta),
};
