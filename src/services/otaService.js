const crypto = require('crypto');

const logger = require('../utils/logger');
const { HMAC_SECRET, PUBLIC_BASE_URL } = require('../config');
const { readManifest, statBinary } = require('../data/firmwareStore');
const { sendCommandToESP } = require('../websocket/espTunnel');

// O ESP não calcula nada: o servidor já tem o HMAC_SECRET e entrega a URL
// assinada e pronta. A janela de ±300 s do validateTimestamp faz o link expirar
// sozinho, o que é exatamente o que se quer para um binário que carrega as
// credenciais de WiFi embutidas.
function buildDownloadUrl() {
  if (!PUBLIC_BASE_URL) return null;

  const token = `esp32-${Math.floor(Date.now() / 1000)}`;
  const hmac = crypto.createHmac('sha256', HMAC_SECRET).update(token).digest('hex');
  const base = PUBLIC_BASE_URL.replace(/\/+$/, '');

  return `${base}/firmware/latest.bin?token=${encodeURIComponent(token)}&hmac=${hmac}`;
}

async function startUpdate(espMac, { force = false } = {}) {
  const manifest = readManifest();
  if (!manifest || !statBinary()) {
    return { ok: false, error: 'Nenhum firmware publicado' };
  }

  const url = buildDownloadUrl();
  if (!url) {
    return { ok: false, error: 'PUBLIC_BASE_URL não configurado no .env' };
  }

  const command = {
    action: 'ota',
    url,
    version: manifest.version,
    size: manifest.size,
    sha256: manifest.sha256
  };
  if (force) command.force = true;

  // O ACK confirma só o aceite do comando — o flash em si leva ~1 min e chega
  // depois como ota_progress/ota_result, então este timeout não precisa
  // cobrir o download.
  const response = await sendCommandToESP(espMac, command, 15000);

  if (response?.status === 'error') {
    const error = response.error || response.message || 'Falha na comunicação com ESP';
    logger.warn(`OTA refused by ${espMac}: ${error}`);
    return { ok: false, error };
  }

  logger.info(`OTA started on ${espMac} (version=${manifest.version})`);
  return { ok: true, version: manifest.version };
}

module.exports = {
  buildDownloadUrl,
  startUpdate
};
