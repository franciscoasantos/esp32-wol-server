// Camada de comandos de LED, independente de HTTP.
//
// Nasceu de dentro das rotas: as rotinas agendadas, o despertador e as
// notificações precisam mandar cor/efeito/padrão exatamente como o POST manda,
// incluindo persistência e SSE. Duplicar isso nas duas pontas ia divergir.

const { getClientByMac, setLastLedColor, setLastPattern } = require('../data/clientsStore');
const { sendCommandToESP } = require('../websocket/espTunnel');
const { notifyClientState, notifyClientEffect } = require('../utils/sse');

// Efeito ativo por dispositivo (em memória). O ESP roda o efeito no firmware e
// não reporta estado de volta, então o servidor é a fonte da verdade aqui.
const activeEffects = new Map(); // espMac -> 'breathing' | 'fire' | ...

function setActiveEffect(espMac, effect) {
  if (!effect || effect === 'none') {
    activeEffects.delete(espMac);
  } else {
    activeEffects.set(espMac, effect);
  }
  notifyClientEffect(espMac, effect && effect !== 'none' ? effect : null);
}

function getActiveEffect(espMac) {
  return activeEffects.get(espMac) || null;
}

function buildResultSummary(action, results) {
  const okCount = results.filter((item) => item.ok).length;
  return {
    status: okCount > 0 ? 'ok' : 'error',
    action,
    okCount,
    failCount: results.length - okCount,
    results
  };
}

// Executa uma operação por dispositivo em paralelo, sempre resolvendo com um
// item de resultado — nunca rejeitando, para um ESP offline não derrubar os
// outros do lote.
async function forEachTarget(espMacs, action, operation) {
  const results = await Promise.all(espMacs.map(async (espMac) => {
    const client = getClientByMac(espMac);
    if (!client) {
      return { espMac, ok: false, error: 'Cliente não encontrado' };
    }

    try {
      return await operation(espMac, client);
    } catch (error) {
      return { espMac, ok: false, error: error.message };
    }
  }));

  return buildResultSummary(action, results);
}

// Cor sólida. `w` só vai para fitas SK6812; `fadeMs` faz o firmware interpolar.
function applyColor(espMacs, { r, g, b, w = null, fadeMs = null }) {
  return forEachTarget(espMacs, 'led', async (espMac, client) => {
    const command = { action: 'led', r, g, b };
    if (client.ledType === 'sk6812' && w !== null) command.w = w;
    if (fadeMs) command.fadeMs = fadeMs;

    const response = await sendCommandToESP(espMac, command);
    if (response?.status === 'error') {
      return { espMac, ok: false, error: response.error || 'Falha na comunicação com ESP' };
    }

    // Usa valores confirmados pelo ACK (ou fallback para os do request)
    const confirmed = {
      r: typeof response?.r === 'number' ? response.r : r,
      g: typeof response?.g === 'number' ? response.g : g,
      b: typeof response?.b === 'number' ? response.b : b
    };
    setLastLedColor(espMac, confirmed);
    setActiveEffect(espMac, 'none'); // cor sólida interrompe efeito (espelha o firmware)
    notifyClientState(espMac, { ...confirmed, w: response?.w || 0 });

    return { espMac, ok: true, response };
  });
}

// Padrão estático (gradiente ou segmentos). `build(client)` devolve o comando,
// o padrão a persistir e a cor representativa.
function applyPattern(espMacs, action, build, fadeMs = null) {
  return forEachTarget(espMacs, action, async (espMac, client) => {
    const { command, pattern, representative } = build(client);
    if (fadeMs) command.fadeMs = fadeMs;

    const response = await sendCommandToESP(espMac, command);
    if (response?.status === 'error') {
      return { espMac, ok: false, error: response.error || 'Falha na comunicação com ESP' };
    }

    setLastPattern(espMac, pattern, representative);
    setActiveEffect(espMac, 'none');
    notifyClientState(espMac, { ...representative, w: representative.w || 0 });

    return { espMac, ok: true, response };
  });
}

// Um único comando: a animação roda no firmware. 'none' interrompe.
function applyEffect(espMacs, { effect, color = null, speed = null, intensity = null }) {
  return forEachTarget(espMacs, 'effect', async (espMac) => {
    const command = { action: 'effect', effect };
    if (color) { command.r = color.r; command.g = color.g; command.b = color.b; }
    if (speed !== null) command.speed = speed;
    if (intensity !== null) command.intensity = intensity;

    const response = await sendCommandToESP(espMac, command);
    if (response?.status === 'error') {
      return { espMac, ok: false, error: response.error || 'Falha na comunicação com ESP' };
    }

    setActiveEffect(espMac, effect);
    return { espMac, ok: true, response };
  });
}

function sendWol(espMacs, targetMac) {
  return forEachTarget(espMacs, 'wol', async (espMac) => {
    if (!targetMac) {
      return { espMac, ok: false, error: 'MAC alvo não informado' };
    }

    const response = await sendCommandToESP(espMac, { action: 'wol', mac: targetMac });
    if (response?.status === 'error') {
      return { espMac, ok: false, error: response.error || 'Falha na comunicação com ESP' };
    }

    return { espMac, ok: true, response };
  });
}

// Estado atual de um dispositivo, para quem precisa restaurar depois de tomar
// a fita emprestada (notificação, ritual de WoL).
function snapshot(espMac) {
  const client = getClientByMac(espMac);
  if (!client) return null;
  return {
    espMac,
    effect: getActiveEffect(espMac),
    pattern: client.lastPattern || (client.lastLedColor
      ? { type: 'solid', color: client.lastLedColor }
      : null)
  };
}

// Devolve a fita ao estado capturado por snapshot().
async function restore(state, { fadeMs = 400 } = {}) {
  if (!state) return;
  const macs = [state.espMac];

  if (state.effect) {
    await applyEffect(macs, { effect: state.effect });
    return;
  }

  const pattern = state.pattern;
  if (!pattern) return;

  if (pattern.type === 'gradient') {
    await applyPattern(macs, 'gradient', () => ({
      command: { action: 'gradient', stops: pattern.stops },
      pattern,
      representative: { r: pattern.stops[0].r, g: pattern.stops[0].g, b: pattern.stops[0].b }
    }), fadeMs);
    return;
  }

  if (pattern.type === 'segments') {
    await applyPattern(macs, 'segments', () => ({
      command: { action: 'segments', segments: pattern.segments },
      pattern,
      representative: { r: pattern.segments[0].r, g: pattern.segments[0].g, b: pattern.segments[0].b }
    }), fadeMs);
    return;
  }

  await applyColor(macs, { ...pattern.color, fadeMs });
}

module.exports = {
  setActiveEffect,
  getActiveEffect,
  buildResultSummary,
  applyColor,
  applyPattern,
  applyEffect,
  sendWol,
  snapshot,
  restore
};
