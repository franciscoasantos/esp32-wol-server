const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'scenes.json');

function createDefaultStore() {
  return { scenes: [] };
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
    if (!parsed || typeof parsed !== 'object') return createDefaultStore();
    return { scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [] };
  } catch (_e) {
    return createDefaultStore();
  }
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function getScenes() {
  return loadStore().scenes;
}

function saveScene(payload) {
  const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
  if (!name) throw new Error('name é obrigatório');

  const { r, g, b } = payload?.color || {};
  if (![r, g, b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
    throw new Error('color deve ter r, g, b inteiros entre 0 e 255');
  }

  const espMacs = Array.isArray(payload?.espMacs) ? payload.espMacs.filter(Boolean) : [];
  if (!espMacs.length) throw new Error('espMacs é obrigatório');

  const store = loadStore();
  const id = String(Date.now());
  const scene = { id, name, color: { r, g, b }, espMacs, createdAt: new Date().toISOString() };
  store.scenes.push(scene);
  saveStore(store);
  return scene;
}

function deleteScene(id) {
  const store = loadStore();
  const idx = store.scenes.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error('Cena não encontrada');
  store.scenes.splice(idx, 1);
  saveStore(store);
}

module.exports = { getScenes, saveScene, deleteScene };
