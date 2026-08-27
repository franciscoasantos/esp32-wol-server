const fs = require('fs');
const crypto = require('crypto');

const logger = require('../utils/logger');
const { validateHMAC, validateTimestamp } = require('../auth/hmac');
const {
  BINARY_PATH,
  MAX_IMAGE_BYTES,
  parseAppDescriptor,
  ensureDir,
  readManifest,
  writeManifest,
  statBinary
} = require('../data/firmwareStore');

const HEADER_BYTES = 256;

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

// GET /firmware/latest.bin?token=&hmac=
//
// Precisa ficar acima da checagem de sessão no server.js: o ESP32 não tem
// cookie JWT, e sob a rota protegida ele baixaria o HTML de /login no lugar do
// binário. A autenticação é o mesmo HMAC do túnel, e a janela de ±300 s do
// validateTimestamp já torna a URL naturalmente efêmera.
//
// Vale lembrar por que isto não pode ser público: o .bin carrega WIFI_PASS e o
// SECRET do HMAC como strings literais, porque config.h é compilado junto.
function handleFirmwareDownload(req, res) {
  const query = new URL(req.url, 'http://localhost').searchParams;
  const token = query.get('token');
  const hmac = query.get('hmac');

  if (!token || !hmac || !validateTimestamp(token) || !validateHMAC(token, hmac)) {
    logger.warn('Firmware download rejected: invalid token/hmac');
    res.writeHead(401);
    return res.end('Unauthorized');
  }

  const stat = statBinary();
  if (!stat) {
    logger.warn('Firmware download requested but no binary published');
    res.writeHead(404);
    return res.end('Not Found');
  }

  // Content-Length explícito de propósito. Sem ele o Node responde em
  // Transfer-Encoding: chunked, e aí o esp_https_ota perde
  // esp_https_ota_get_image_size() — o update ainda funciona, mas sem barra de
  // progresso. O handleStatic de /assets tem justamente esse problema, por isso
  // não é reaproveitado aqui.
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store'
  });

  if (req.method === 'HEAD') return res.end();

  logger.info(`Serving firmware (${stat.size} bytes)`);
  const stream = fs.createReadStream(BINARY_PATH);
  stream.on('error', (error) => {
    logger.error('Failed to stream firmware:', error.message);
    res.destroy();
  });
  stream.pipe(res);
}

// GET /api/firmware — manifesto do que está publicado (para a UI).
function handleFirmwareInfo(req, res) {
  const manifest = readManifest();
  if (!manifest) return sendJson(res, 200, { published: false });
  return sendJson(res, 200, { published: true, ...manifest });
}

// POST /api/firmware — upload cru (Content-Type: application/octet-stream).
//
// O navegador manda o File direto como corpo: escrever um parser multipart num
// servidor sem framework não se pagaria, e a versão vem do próprio binário.
function handleFirmwareUpload(req, res) {
  ensureDir();

  const tmpPath = `${BINARY_PATH}.upload`;
  const out = fs.createWriteStream(tmpPath);
  const hash = crypto.createHash('sha256');
  const head = [];

  let headBytes = 0;
  let size = 0;
  let finished = false;

  const cleanup = () => fs.promises.unlink(tmpPath).catch(() => undefined);

  const fail = (status, message) => {
    if (finished) return;
    finished = true;
    out.destroy();
    cleanup();
    logger.warn(`Firmware upload rejected: ${message}`);
    sendJson(res, status, { error: message });
    req.destroy();
  };

  req.on('data', (chunk) => {
    if (finished) return;

    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) {
      return fail(413, `Imagem maior que o slot OTA (${MAX_IMAGE_BYTES} bytes)`);
    }

    hash.update(chunk);
    if (headBytes < HEADER_BYTES) {
      head.push(chunk);
      headBytes += chunk.length;
    }

    if (!out.write(chunk)) req.pause();
  });

  out.on('drain', () => req.resume());

  out.on('error', (error) => fail(500, `Falha ao gravar: ${error.message}`));

  req.on('aborted', () => fail(400, 'Upload interrompido'));

  req.on('end', () => {
    if (finished) return;

    const descriptor = parseAppDescriptor(Buffer.concat(head));
    if (!descriptor) {
      return fail(400, 'Arquivo não é uma imagem de app do ESP32');
    }

    out.end(async () => {
      if (finished) return;
      finished = true;

      try {
        await fs.promises.rename(tmpPath, BINARY_PATH);
      } catch (error) {
        await cleanup();
        logger.error('Failed to publish firmware:', error.message);
        return sendJson(res, 500, { error: 'Falha ao publicar o firmware' });
      }

      const manifest = writeManifest({
        version: descriptor.version,
        projectName: descriptor.projectName,
        idfVer: descriptor.idfVer,
        size,
        sha256: hash.digest('hex'),
        uploadedAt: new Date().toISOString()
      });

      logger.info(`Firmware published: ${manifest.projectName} ${manifest.version} (${size} bytes)`);
      sendJson(res, 200, { published: true, ...manifest });
    });
  });
}

module.exports = {
  handleFirmwareDownload,
  handleFirmwareInfo,
  handleFirmwareUpload
};
