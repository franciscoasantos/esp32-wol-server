const crypto = require('crypto');
const logger = require('../utils/logger');
const { HMAC_SECRET } = require('../config');

function validateHMAC(token, hmac) {
  const calculatedHMAC = crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(token)
    .digest('hex');

  logger.debug(`HMAC validation: Received=${hmac.substring(0, 16)}..., Expected=${calculatedHMAC.substring(0, 16)}...`);

  return calculatedHMAC === hmac;
}

function validateTimestamp(token) {
  const match = token.match(/esp32-(\d+)/);
  if (!match) {
    logger.error("Token format invalid:", token);
    return false;
  }

  const timestamp = parseInt(match[1]);
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.abs(now - timestamp);

  logger.debug(`Timestamp validation: ESP=${timestamp}, Server=${now}, Diff=${diff}s`);

  // Aceita até 5 minutos de diferença
  if (diff >= 300) {
    logger.warn(`Timestamp difference too large (${diff}s). Check ESP32 NTP sync.`);
    return false;
  }
  
  return true;
}

module.exports = {
  validateHMAC,
  validateTimestamp
};
