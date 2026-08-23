// Cenas: um estado por dispositivo, não uma cor só.
//
// O formato antigo era { name, color, espMacs } — não conseguia guardar um
// efeito, um gradiente, nem cores diferentes por fita. Cenas gravadas nesse
// formato são convertidas na leitura, então nada precisa ser migrado à mão.

const fs = require('fs');
const path = require('path');
const { normalizeMac } = require('./clientsStore');

const DATA_FILE = path.join(__dirname, 'scenes.json');

const MODES = new Set(['solid', 'gradient', 'segments', 'effect', 'off']);
const MAX_STOPS = 8;
const MAX_SEGMENTS = 8;

function createDefaultStore() {
  return { scenes: [] };
}

// Date.now() sozinho colide se duas cenas forem salvas no mesmo milissegundo.
let idCounter = 0;
function nextId() {
  idCounter = (idCounter + 1) % 1000;
  return `${Date.now()}-${idCounter}`;
}

function parseColor(raw, label) {
  const { r, g, b } = raw || {};
  if (![r, g, b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
    throw new Error(`${label}: r/g/b devem ser inteiros entre 0 e 255`);
  }
  const color = { r, g, b };
  if (Number.isInteger(raw.w) && raw.w >= 0 && raw.w <= 255) color.w = raw.w;
  return color;
}

function parseDevice(raw, index) {
  const espMac = normalizeMac(raw?.espMac);
  if (!espMac) throw new Error(`dispositivo ${index}: espMac inválido`);

  const mode = typeof raw?.mode === 'string' ? raw.mode.trim().toLowerCase() : 'solid';
  if (!MODES.has(mode)) {
    throw new Error(`dispositivo ${index}: mode deve ser solid, gradient, segments, effect ou off`);
  }

  if (mode === 'off') return { espMac, mode };

  if (mode === 'solid') {
    return { espMac, mode, color: parseColor(raw?.color, `dispositivo ${index}`) };
  }

  if (mode === 'gradient') {
    const stops = Array.isArray(raw?.stops) ? raw.stops : [];
    if (stops.length < 2 || stops.length > MAX_STOPS) {
      throw new Error(`dispositivo ${index}: stops precisa ter de 2 a ${MAX_STOPS} itens`);
    }
    let previous = -1;
    return {
      espMac,
      mode,
      stops: stops.map((stop, i) => {
        if (!Number.isInteger(stop?.pos) || stop.pos < 0 || stop.pos > 255) {
          throw new Error(`dispositivo ${index}, stop ${i}: pos inválido`);
        }
        if (stop.pos < previous) {
          throw new Error(`dispositivo ${index}: stops devem vir em ordem crescente de pos`);
        }
        previous = stop.pos;
        return { pos: stop.pos, ...parseColor(stop, `dispositivo ${index}, stop ${i}`) };
      })
    };
  }

  if (mode === 'segments') {
    const segments = Array.isArray(raw?.segments) ? raw.segments : [];
    if (!segments.length || segments.length > MAX_SEGMENTS) {
      throw new Error(`dispositivo ${index}: segments precisa ter de 1 a ${MAX_SEGMENTS} itens`);
    }
    return {
      espMac,
      mode,
      segments: segments.map((segment, i) => {
        const { from, to } = segment || {};
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
          throw new Error(`dispositivo ${index}, segmento ${i}: from/to inválidos`);
        }
        return { from, to, ...parseColor(segment, `dispositivo ${index}, segmento ${i}`) };
      })
    };
  }

  // effect
  const effect = typeof raw?.effect === 'string' ? raw.effect.trim().toLowerCase() : '';
  if (!effect) throw new Error(`dispositivo ${index}: effect é obrigatório`);
  const device = { espMac, mode, effect };
  if (raw?.color) device.color = parseColor(raw.color, `dispositivo ${index}`);
  if (Number.isInteger(raw?.speed)) device.speed = raw.speed;
  if (Number.isInteger(raw?.intensity)) device.intensity = raw.intensity;
  return device;
}

// Cor que representa a cena no swatch da lista.
function previewColor(devices) {
  for (const device of devices) {
    if (device.mode === 'solid') return device.color;
    if (device.mode === 'gradient') return device.stops[0];
    if (device.mode === 'segments') return device.segments[0];
    if (device.mode === 'effect' && device.color) return device.color;
  }
  return { r: 0, g: 0, b: 0 };
}

// Converte o formato antigo ({ color, espMacs }) para o novo, sem tocar no
// disco: a gravação só acontece quando a cena for editada.
function migrate(scene) {
  if (Array.isArray(scene?.devices)) return scene;

  const macs = Array.isArray(scene?.espMacs) ? scene.espMacs : [];
  const color = scene?.color || { r: 0, g: 0, b: 0 };
  return {
    ...scene,
    devices: macs
      .map((mac) => normalizeMac(mac))
      .filter(Boolean)
      .map((espMac) => ({ espMac, mode: 'solid', color }))
  };
}

function loadStore() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(createDefaultStore(), null, 2), 'utf-8');
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    const scenes = Array.isArray(parsed?.scenes) ? parsed.scenes.map(migrate) : [];
    return { scenes };
  } catch (_e) {
    return createDefaultStore();
  }
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function getScenes() {
  return loadStore().scenes
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((scene) => ({ ...scene, preview: previewColor(scene.devices) }));
}

function getSceneById(id) {
  return loadStore().scenes.find((scene) => scene.id === id) || null;
}

// Cria ou atualiza (quando `id` vem no payload).
function saveScene(payload) {
  const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
  if (!name) throw new Error('name é obrigatório');

  const rawDevices = Array.isArray(payload?.devices) ? payload.devices : [];
  if (!rawDevices.length) throw new Error('devices é obrigatório');

  const devices = rawDevices.map(parseDevice);

  const store = loadStore();
  const idx = payload?.id ? store.scenes.findIndex((scene) => scene.id === payload.id) : -1;

  if (idx >= 0) {
    store.scenes[idx] = {
      ...store.scenes[idx],
      name,
      devices,
      updatedAt: new Date().toISOString()
    };
  } else {
    store.scenes.push({
      id: nextId(),
      name,
      devices,
      order: store.scenes.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  saveStore(store);
  const saved = idx >= 0 ? store.scenes[idx] : store.scenes[store.scenes.length - 1];
  return { ...saved, preview: previewColor(saved.devices) };
}

function renameScene(id, name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) throw new Error('name é obrigatório');

  const store = loadStore();
  const scene = store.scenes.find((item) => item.id === id);
  if (!scene) throw new Error('Cena não encontrada');

  scene.name = trimmed;
  scene.updatedAt = new Date().toISOString();
  saveStore(store);
  return { ...scene, preview: previewColor(scene.devices) };
}

// Reordena pela lista de ids; quem não vier vai para o fim, na ordem atual.
function reorderScenes(ids) {
  if (!Array.isArray(ids)) throw new Error('ids deve ser um array');

  const store = loadStore();
  const position = new Map(ids.map((id, index) => [id, index]));
  store.scenes.forEach((scene) => {
    scene.order = position.has(scene.id) ? position.get(scene.id) : ids.length;
  });
  store.scenes.sort((a, b) => a.order - b.order);
  store.scenes.forEach((scene, index) => { scene.order = index; });

  saveStore(store);
  return getScenes();
}

function deleteScene(id) {
  const store = loadStore();
  const idx = store.scenes.findIndex((scene) => scene.id === id);
  if (idx < 0) throw new Error('Cena não encontrada');
  store.scenes.splice(idx, 1);
  saveStore(store);
}

module.exports = {
  getScenes,
  getSceneById,
  saveScene,
  renameScene,
  reorderScenes,
  deleteScene,
  previewColor
};
