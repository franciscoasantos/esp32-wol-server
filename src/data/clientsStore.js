const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'clients.json');

function normalizeMac(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/-/g, ':').toUpperCase();
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(cleaned)) return null;
  return cleaned;
}

function normalizeLedType(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'ws2812b' || normalized === 'sk6812') {
    return normalized;
  }
  return null;
}

function createDefaultStore() {
  return {
    clients: []
  };
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(createDefaultStore(), null, 2), 'utf-8');
  }
}

function loadStore() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object') {
      return createDefaultStore();
    }

    return {
      clients: Array.isArray(parsed.clients) ? parsed.clients : []
    };
  } catch (_e) {
    return createDefaultStore();
  }
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function getClients() {
  const store = loadStore();
  return store.clients;
}

function getClientByMac(espMac) {
  const normalized = normalizeMac(espMac);
  if (!normalized) return null;

  const store = loadStore();
  return store.clients.find((client) => client.espMac === normalized) || null;
}

function upsertClient(payload) {
  const espMac = normalizeMac(payload?.espMac);
  if (!espMac) {
    throw new Error('espMac inválido');
  }

  const nickname = typeof payload?.nickname === 'string' ? payload.nickname.trim() : '';
  if (!nickname) {
    throw new Error('nickname é obrigatório');
  }

  const ledCount = Number.parseInt(payload?.ledCount, 10);
  if (!Number.isInteger(ledCount) || ledCount < 1 || ledCount > 2048) {
    throw new Error('ledCount deve ser um inteiro entre 1 e 2048');
  }

  const ledPin = Number.parseInt(payload?.ledPin, 10);
  if (!Number.isInteger(ledPin) || ledPin < 0 || ledPin > 48) {
    throw new Error('ledPin deve ser um inteiro entre 0 e 48');
  }

  const ledType = normalizeLedType(payload?.ledType);
  if (!ledType) {
    throw new Error('ledType deve ser ws2812b ou sk6812');
  }

  const store = loadStore();
  // Permite cor no formato { r: 0-255, g: 0-255, b: 0-255 }
  let lastLedColor = undefined;
  if (payload?.lastLedColor && typeof payload.lastLedColor === 'object') {
    const { r, g, b } = payload.lastLedColor;
    if (
      Number.isInteger(r) && r >= 0 && r <= 255 &&
      Number.isInteger(g) && g >= 0 && g <= 255 &&
      Number.isInteger(b) && b >= 0 && b <= 255
    ) {
      lastLedColor = { r, g, b };
    }
  }
  const nextClient = {
    espMac,
    nickname,
    ledCount,
    ledPin,
    ledType,
    updatedAt: new Date().toISOString(),
    ...(lastLedColor ? { lastLedColor } : {})
  };

  const idx = store.clients.findIndex((item) => item.espMac === espMac);
  if (idx >= 0) {
    store.clients[idx] = {
      ...store.clients[idx],
      ...nextClient,
      createdAt: store.clients[idx].createdAt || new Date().toISOString()
    };
  } else {
    store.clients.push({
      ...nextClient,
      createdAt: new Date().toISOString()
    });
  }

  saveStore(store);
  return store.clients.find((item) => item.espMac === espMac);
}

module.exports = {
  normalizeMac,
  getClients,
  getClientByMac,
  upsertClient
};
