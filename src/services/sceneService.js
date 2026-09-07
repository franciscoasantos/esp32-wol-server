// Aplicar e capturar cenas.
//
// Aplicar virou trabalho do servidor: cada dispositivo da cena pode estar num
// modo diferente (um em gradiente, outro em efeito), e o cliente teria que
// orquestrar isso comando a comando.

const { getActiveEffectState, applyColor, applyEffect, applyPattern, snapshot } = require('./ledService');
const { previewColor } = require('../data/scenesStore');

const APPLY_FADE_MS = 600;

async function applyDevice(device) {
  const macs = [device.espMac];

  switch (device.mode) {
    case 'off':
      return applyColor(macs, { r: 0, g: 0, b: 0, fadeMs: APPLY_FADE_MS });

    case 'solid':
      return applyColor(macs, { ...device.color, fadeMs: APPLY_FADE_MS });

    case 'gradient':
      return applyPattern(macs, 'gradient', () => ({
        command: { action: 'gradient', stops: device.stops },
        pattern: { type: 'gradient', stops: device.stops },
        representative: { r: device.stops[0].r, g: device.stops[0].g, b: device.stops[0].b }
      }), APPLY_FADE_MS);

    case 'segments':
      return applyPattern(macs, 'segments', () => ({
        command: { action: 'segments', segments: device.segments },
        pattern: { type: 'segments', segments: device.segments },
        representative: { r: device.segments[0].r, g: device.segments[0].g, b: device.segments[0].b }
      }), APPLY_FADE_MS);

    case 'effect':
      return applyEffect(macs, {
        effect: device.effect,
        color: device.color || null,
        speed: Number.isInteger(device.speed) ? device.speed : null,
        intensity: Number.isInteger(device.intensity) ? device.intensity : null
      });

    default:
      return null;
  }
}

// Em paralelo: são dispositivos diferentes, e o túnel já serializa por MAC.
async function applyScene(scene) {
  const summaries = await Promise.all(scene.devices.map((device) => applyDevice(device)));

  const results = summaries
    .filter(Boolean)
    .flatMap((summary) => summary.results);

  const okCount = results.filter((item) => item.ok).length;
  return {
    status: okCount > 0 ? 'ok' : 'error',
    action: 'scene',
    okCount,
    failCount: results.length - okCount,
    results
  };
}

// Fotografa o que os dispositivos estão mostrando agora, no formato de cena.
// O efeito ativo vem da memória do servidor; o padrão, do que foi persistido.
function captureDevices(espMacs) {
  return espMacs.map((espMac) => {
    // Guarda também cor base e parâmetros: capturar um fogo em intensidade 70
    // e reaplicá-lo no padrão não seria capturar o estado atual.
    const active = getActiveEffectState(espMac);
    if (active) {
      const device = { espMac, mode: 'effect', effect: active.effect };
      if (active.color) device.color = active.color;
      if (Number.isInteger(active.speed)) device.speed = active.speed;
      if (Number.isInteger(active.intensity)) device.intensity = active.intensity;
      return device;
    }

    const state = snapshot(espMac);
    const pattern = state?.pattern;

    if (!pattern) return { espMac, mode: 'off' };
    if (pattern.type === 'gradient') return { espMac, mode: 'gradient', stops: pattern.stops };
    if (pattern.type === 'segments') return { espMac, mode: 'segments', segments: pattern.segments };

    const color = pattern.color || { r: 0, g: 0, b: 0 };
    const isOff = !color.r && !color.g && !color.b && !color.w;
    return isOff ? { espMac, mode: 'off' } : { espMac, mode: 'solid', color };
  });
}

module.exports = { applyScene, captureDevices, previewColor };
