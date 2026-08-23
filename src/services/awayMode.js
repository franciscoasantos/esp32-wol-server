// Modo ausente: acende e apaga em intervalos sorteados dentro de uma janela,
// para a casa não parecer vazia.
//
// Não é um agendamento — é uma máquina de estados por dispositivo, avaliada no
// mesmo tick de 30 s do agendador. Cada dispositivo sorteia a própria duração,
// senão as fitas piscariam em sincronia e denunciariam a automação.

const logger = require('../utils/logger');
const { loadConfig } = require('../data/awayStore');
const { applyColor } = require('./ledService');

const FADE_MS = 2000;

// espMac -> { on, nextChangeAt }
const state = new Map();

function randomMinutes(min, max) {
  return min + Math.random() * (max - min);
}

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Janela pode cruzar a meia-noite (ex.: 18:00 às 01:00).
function insideWindow(nowMinutes, start, end) {
  return start <= end
    ? nowMinutes >= start && nowMinutes < end
    : nowMinutes >= start || nowMinutes < end;
}

async function setDevice(espMac, on, color) {
  const target = on ? color : { r: 0, g: 0, b: 0 };
  await applyColor([espMac], { ...target, fadeMs: FADE_MS });
}

async function tick(now = new Date()) {
  const config = loadConfig();

  if (!config.enabled || !config.espMacs.length) {
    state.clear();
    return;
  }

  const active = insideWindow(minutesOfDay(now), config.startMinutes, config.endMinutes);
  const timestamp = now.getTime();

  for (const espMac of config.espMacs) {
    const current = state.get(espMac);

    if (!active) {
      // Saiu da janela: apaga uma vez e esquece o dispositivo.
      if (current) {
        state.delete(espMac);
        if (current.on) {
          await setDevice(espMac, false, config.color);
          logger.info(`Modo ausente: fim da janela, ${espMac} apagado`);
        }
      }
      continue;
    }

    if (!current) {
      // Entrou na janela: começa aceso, com duração sorteada.
      const minutes = randomMinutes(config.minOnMin, config.maxOnMin);
      state.set(espMac, { on: true, nextChangeAt: timestamp + minutes * 60000 });
      await setDevice(espMac, true, config.color);
      logger.info(`Modo ausente: ${espMac} aceso por ${Math.round(minutes)} min`);
      continue;
    }

    if (timestamp < current.nextChangeAt) continue;

    const on = !current.on;
    const minutes = on
      ? randomMinutes(config.minOnMin, config.maxOnMin)
      : randomMinutes(config.minOffMin, config.maxOffMin);

    state.set(espMac, { on, nextChangeAt: timestamp + minutes * 60000 });
    await setDevice(espMac, on, config.color);
    logger.info(`Modo ausente: ${espMac} ${on ? 'aceso' : 'apagado'} por ${Math.round(minutes)} min`);
  }
}

// Estado corrente, para a UI mostrar o que está acontecendo agora.
function describe() {
  const config = loadConfig();
  const now = new Date();
  return {
    ...config,
    windowActive: config.enabled && insideWindow(minutesOfDay(now), config.startMinutes, config.endMinutes),
    devices: [...state.entries()].map(([espMac, item]) => ({
      espMac,
      on: item.on,
      nextChangeAt: new Date(item.nextChangeAt).toISOString()
    }))
  };
}

// Chamado quando a configuração muda: sem isso o estado antigo continuaria
// valendo com dispositivos que saíram da lista.
function reset() {
  state.clear();
}

module.exports = { tick, describe, reset, insideWindow };
