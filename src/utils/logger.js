function log(level, ...args) {
  const now = new Date();
  const timestamp = now.toLocaleDateString() + ' ' + now.toLocaleTimeString();
  console.log(`[${timestamp}] [${level}]`, ...args);
}

const logger = {
  error: (...args) => log('ERROR', ...args),
  warn: (...args) => log('WARN', ...args),
  info: (...args) => log('INFO', ...args),
  debug: (...args) => log('DEBUG', ...args)
};

module.exports = logger;
