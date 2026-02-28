const fs = require('fs');
const path = require('path');
const { normalizeMac } = require('./clientsStore');

const DATA_FILE = path.join(__dirname, 'wolTargets.json');

function createDefaultStore() {
  return {
    targets: []
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
      targets: Array.isArray(parsed.targets) ? parsed.targets : []
    };
  } catch (_e) {
    return createDefaultStore();
  }
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function getWolTargets() {
  const store = loadStore();
  return store.targets;
}

function upsertWolTarget(payload) {
  const mac = normalizeMac(payload?.mac);
  if (!mac) {
    throw new Error('MAC inválido');
  }

  const nickname = typeof payload?.nickname === 'string' ? payload.nickname.trim() : '';
  if (!nickname) {
    throw new Error('nickname é obrigatório');
  }

  const store = loadStore();
  const idx = store.targets.findIndex((item) => item.mac === mac);
  const nextTarget = {
    mac,
    nickname,
    updatedAt: new Date().toISOString()
  };

  if (idx >= 0) {
    store.targets[idx] = {
      ...store.targets[idx],
      ...nextTarget,
      createdAt: store.targets[idx].createdAt || new Date().toISOString()
    };
  } else {
    store.targets.push({
      ...nextTarget,
      createdAt: new Date().toISOString()
    });
  }

  saveStore(store);
  return store.targets.find((item) => item.mac === mac);
}

module.exports = {
  getWolTargets,
  upsertWolTarget
};
