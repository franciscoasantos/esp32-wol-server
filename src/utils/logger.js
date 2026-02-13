function log(level, ...args) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${timestamp}] [${level}]`, ...args);
}

const logger = {
  error: (...args) => log('ERROR', ...args),
  warn: (...args) => log('WARN', ...args),
  info: (...args) => log('INFO', ...args),
  debug: (...args) => log('DEBUG', ...args)
};

module.exports = logger;
