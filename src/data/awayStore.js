// Configuração do modo ausente. Um registro só, não uma lista.

const fs = require('fs');
const path = require('path');
const { normalizeMac } = require('./clientsStore');

const DATA_FILE = path.join(__dirname, 'away.json');

function defaults() {
  return {
    enabled: false,
    espMacs: [],
    // Janela em que a simulação acontece (minutos desde a meia-noite).
    // 18:00 às 23:30 por padrão: fora disso a casa apagada não chama atenção.
    startMinutes: 18 * 60,
    endMinutes: 23 * 60 + 30,
    // Duração sorteada de cada trecho aceso e apagado.
    minOnMin: 12,
    maxOnMin: 45,
    minOffMin: 8,
    maxOffMin: 30,
    color: { r: 255, g: 170, b: 90 }
  };
}

function loadConfig() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaults(), null, 2), 'utf-8');
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    return { ...defaults(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch (_e) {
    return defaults();
  }
}

function parseMinutes(value, fallback) {
  if (!Number.isInteger(value)) return fallback;
  if (value < 0 || value > 1439) throw new Error('horários devem estar entre 0 e 1439 minutos');
  return value;
}

function parseDuration(value, fallback, label) {
  if (!Number.isInteger(value)) return fallback;
  if (value < 1 || value > 240) throw new Error(`${label} deve estar entre 1 e 240 minutos`);
  return value;
}

function saveConfig(payload) {
  const current = loadConfig();

  const espMacs = Array.isArray(payload?.espMacs)
    ? [...new Set(payload.espMacs.map((mac) => normalizeMac(mac)).filter(Boolean))]
    : current.espMacs;

  const next = {
    enabled: typeof payload?.enabled === 'boolean' ? payload.enabled : current.enabled,
    espMacs,
    startMinutes: parseMinutes(payload?.startMinutes, current.startMinutes),
    endMinutes: parseMinutes(payload?.endMinutes, current.endMinutes),
    minOnMin: parseDuration(payload?.minOnMin, current.minOnMin, 'minOnMin'),
    maxOnMin: parseDuration(payload?.maxOnMin, current.maxOnMin, 'maxOnMin'),
    minOffMin: parseDuration(payload?.minOffMin, current.minOffMin, 'minOffMin'),
    maxOffMin: parseDuration(payload?.maxOffMin, current.maxOffMin, 'maxOffMin'),
    color: current.color
  };

  if (payload?.color) {
    const { r, g, b } = payload.color;
    if (![r, g, b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
      throw new Error('color deve ter r, g, b inteiros entre 0 e 255');
    }
    next.color = { r, g, b };
  }

  if (next.minOnMin > next.maxOnMin) throw new Error('minOnMin não pode ser maior que maxOnMin');
  if (next.minOffMin > next.maxOffMin) throw new Error('minOffMin não pode ser maior que maxOffMin');
  if (next.enabled && !next.espMacs.length) throw new Error('selecione ao menos um dispositivo');

  fs.writeFileSync(DATA_FILE, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

module.exports = { loadConfig, saveConfig };
