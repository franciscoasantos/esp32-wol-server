// Rotinas agendadas. Mesmo padrão dos outros stores: JSON em disco, validação
// no upsert, id derivado do relógio.

const fs = require('fs');
const path = require('path');
const { normalizeMac } = require('./clientsStore');

const DATA_FILE = path.join(__dirname, 'schedules.json');

const TRIGGER_TYPES = new Set(['time', 'sunrise', 'sunset']);
const ACTION_TYPES = new Set(['color', 'effect', 'gradient', 'sunrise', 'off']);

function createDefaultStore() {
  return { schedules: [] };
}

function loadStore() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(createDefaultStore(), null, 2), 'utf-8');
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    return { schedules: Array.isArray(parsed?.schedules) ? parsed.schedules : [] };
  } catch (_e) {
    return createDefaultStore();
  }
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function getSchedules() {
  return loadStore().schedules;
}

function parseTrigger(raw) {
  const type = typeof raw?.type === 'string' ? raw.type.trim().toLowerCase() : '';
  if (!TRIGGER_TYPES.has(type)) {
    throw new Error('trigger.type deve ser time, sunrise ou sunset');
  }

  // Dias da semana: 0 = domingo. Vazio ou ausente = todos os dias.
  const days = Array.isArray(raw?.days)
    ? [...new Set(raw.days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort()
    : [];

  if (type === 'time') {
    const at = typeof raw?.at === 'string' ? raw.at.trim() : '';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) {
      throw new Error('trigger.at deve estar no formato HH:MM');
    }
    return { type, at, days };
  }

  // sunrise/sunset aceitam deslocamento em minutos (negativo = antes)
  const offsetMin = Number.isInteger(raw?.offsetMin) ? raw.offsetMin : 0;
  if (offsetMin < -720 || offsetMin > 720) {
    throw new Error('trigger.offsetMin deve estar entre -720 e 720');
  }
  return { type, offsetMin, days };
}

function parseColor(raw, label) {
  const { r, g, b } = raw || {};
  const valid = [r, g, b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255);
  if (!valid) {
    throw new Error(`${label}: r/g/b devem ser inteiros entre 0 e 255`);
  }
  return { r, g, b };
}

function parseAction(raw) {
  const type = typeof raw?.type === 'string' ? raw.type.trim().toLowerCase() : '';
  if (!ACTION_TYPES.has(type)) {
    throw new Error('action.type deve ser color, effect, gradient, sunrise ou off');
  }

  if (type === 'color') {
    return { type, color: parseColor(raw?.color, 'action.color'), fadeMs: 800 };
  }

  if (type === 'effect') {
    const effect = typeof raw?.effect === 'string' ? raw.effect.trim().toLowerCase() : '';
    if (!effect) throw new Error('action.effect é obrigatório');
    const action = { type, effect };
    if (raw?.color) action.color = parseColor(raw.color, 'action.color');
    if (Number.isInteger(raw?.speed)) action.speed = raw.speed;
    if (Number.isInteger(raw?.intensity)) action.intensity = raw.intensity;
    return action;
  }

  if (type === 'gradient') {
    const stops = Array.isArray(raw?.stops) ? raw.stops : [];
    if (stops.length < 2) throw new Error('action.stops precisa de pelo menos 2 itens');
    return {
      type,
      stops: stops.map((stop, i) => {
        if (!Number.isInteger(stop?.pos) || stop.pos < 0 || stop.pos > 255) {
          throw new Error(`stop ${i}: pos deve ser um inteiro entre 0 e 255`);
        }
        return { pos: stop.pos, ...parseColor(stop, `stop ${i}`) };
      }),
      fadeMs: 1200
    };
  }

  if (type === 'sunrise') {
    const durationMin = Number.isInteger(raw?.durationMin) ? raw.durationMin : 20;
    if (durationMin < 1 || durationMin > 120) {
      throw new Error('action.durationMin deve estar entre 1 e 120');
    }
    return { type, durationMin };
  }

  return { type }; // off
}

function upsertSchedule(payload) {
  const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
  if (!name) throw new Error('name é obrigatório');

  const espMacs = [...new Set((Array.isArray(payload?.espMacs) ? payload.espMacs : [])
    .map((mac) => normalizeMac(mac))
    .filter(Boolean))];
  if (!espMacs.length) throw new Error('espMacs é obrigatório');

  const schedule = {
    id: typeof payload?.id === 'string' && payload.id ? payload.id : String(Date.now()),
    name,
    enabled: payload?.enabled !== false,
    espMacs,
    trigger: parseTrigger(payload?.trigger),
    action: parseAction(payload?.action),
    updatedAt: new Date().toISOString()
  };

  const store = loadStore();
  const idx = store.schedules.findIndex((item) => item.id === schedule.id);
  if (idx >= 0) {
    store.schedules[idx] = { ...store.schedules[idx], ...schedule };
  } else {
    store.schedules.push({ ...schedule, createdAt: new Date().toISOString() });
  }

  saveStore(store);
  return store.schedules.find((item) => item.id === schedule.id);
}

function deleteSchedule(id) {
  const store = loadStore();
  const idx = store.schedules.findIndex((item) => item.id === id);
  if (idx < 0) throw new Error('Rotina não encontrada');
  store.schedules.splice(idx, 1);
  saveStore(store);
}

module.exports = { getSchedules, upsertSchedule, deleteSchedule };
