// LED como notificação: pisca uma cor e devolve a fita ao que estava antes.
//
// É a peça que deixa qualquer coisa dirigir a fita — webhook de CI, cron, um
// script — sem precisar saber o que estava na tela.

const logger = require('../utils/logger');
const { applyColor, snapshot, restore } = require('./ledService');

const PULSE_ON_MS = 320;
const PULSE_OFF_MS = 240;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Pisca `times` vezes e restaura. Sequencial de propósito: o túnel serializa
// um comando em voo por dispositivo, então mandar em paralelo só enfileira.
async function pulse(espMacs, color, { times = 3, restoreAfter = true } = {}) {
  const states = restoreAfter ? espMacs.map((mac) => snapshot(mac)) : [];

  for (let i = 0; i < times; i++) {
    await applyColor(espMacs, { ...color, fadeMs: 0 });
    await sleep(PULSE_ON_MS);
    await applyColor(espMacs, { r: 0, g: 0, b: 0, fadeMs: 0 });
    await sleep(PULSE_OFF_MS);
  }

  if (restoreAfter) {
    for (const state of states) {
      await restore(state);
    }
  }

  logger.info(`Notificação: ${times} pulso(s) em ${espMacs.length} dispositivo(s)`);
  return { times, restored: restoreAfter };
}

module.exports = { pulse };
