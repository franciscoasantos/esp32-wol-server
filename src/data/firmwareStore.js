const fs = require('fs');
const path = require('path');

const FIRMWARE_DIR = path.join(__dirname, '..', '..', 'firmware');
const BINARY_PATH = path.join(FIRMWARE_DIR, 'latest.bin');
const MANIFEST_PATH = path.join(FIRMWARE_DIR, 'manifest.json');

// Bate com o slot ota_0/ota_1 do partitions.csv do firmware (0x1F0000).
// Recusar aqui evita descobrir que a imagem não cabe só depois de o ESP baixar
// ~1 MB e falhar no esp_ota_write.
const MAX_IMAGE_BYTES = 0x1F0000;

// Uma imagem de app do ESP-IDF começa com 24 B de esp_image_header_t (byte 0 =
// 0xE9) + 8 B do primeiro segment header; o esp_app_desc_t vem logo depois.
// Ler esses 256 bytes é o que permite extrair a versão do próprio binário em
// vez de pedir para o usuário digitar.
const ESP_IMAGE_MAGIC = 0xe9;
const APP_DESC_OFFSET = 0x20;
const APP_DESC_MAGIC = 0xabcd5432;
const APP_DESC_MIN_BYTES = APP_DESC_OFFSET + 0xb0;

function readCString(buffer, offset, size) {
  const slice = buffer.subarray(offset, offset + size);
  const end = slice.indexOf(0);
  return (end === -1 ? slice : slice.subarray(0, end)).toString('utf8').trim();
}

// Devolve { version, projectName, idfVer } ou null se o arquivo não for uma
// imagem de app ESP32 — a checagem que impede publicar um .bin qualquer.
function parseAppDescriptor(header) {
  if (!Buffer.isBuffer(header) || header.length < APP_DESC_MIN_BYTES) return null;
  if (header[0] !== ESP_IMAGE_MAGIC) return null;
  if (header.readUInt32LE(APP_DESC_OFFSET) !== APP_DESC_MAGIC) return null;

  return {
    version: readCString(header, APP_DESC_OFFSET + 0x10, 32),
    projectName: readCString(header, APP_DESC_OFFSET + 0x30, 32),
    idfVer: readCString(header, APP_DESC_OFFSET + 0x70, 32)
  };
}

function ensureDir() {
  fs.mkdirSync(FIRMWARE_DIR, { recursive: true });
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (_e) {
    return null;
  }
}

function writeManifest(manifest) {
  ensureDir();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  return manifest;
}

function statBinary() {
  try {
    return fs.statSync(BINARY_PATH);
  } catch (_e) {
    return null;
  }
}

module.exports = {
  FIRMWARE_DIR,
  BINARY_PATH,
  MANIFEST_PATH,
  MAX_IMAGE_BYTES,
  parseAppDescriptor,
  ensureDir,
  readManifest,
  writeManifest,
  statBinary
};
