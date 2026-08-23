// Despertador nascer-do-sol: rampa de vermelho profundo até branco quente.
//
// Dirigido pelo servidor, um comando a cada STEP_MS com `fadeMs` cobrindo o
// intervalo — o firmware interpola entre os passos, então 12 comandos por
// minuto bastam para parecer contínuo.
//
// Depende do gamma no firmware: numa rampa linear em PWM os primeiros minutos
// seriam invisíveis e os últimos um estouro.

const logger = require('../utils/logger');
const { applyColor } = require('./ledService');

const STEP_MS = 5000;

// Âncoras da rampa. A cor caminha de um vermelho escuro até um branco quente,
// e a escala de brilho é aplicada por cima (em cima do gamma do firmware).
const START = { r: 60, g: 0, b: 0 };
const MID = { r: 255, g: 90, b: 10 };
const END = { r: 255, g: 180, b: 90 };

const running = new Map(); // espMac -> { timer, cancelled }

function mix(a, b, t) {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t)
  };
}

// Cor da rampa em t (0..1): matiz caminhando e brilho subindo junto.
function colorAt(t) {
  const hue = t < 0.5 ? mix(START, MID, t * 2) : mix(MID, END, (t - 0.5) * 2);
  // Piso de 2%: o primeiro passo precisa ser visível sem clarear o quarto.
  const level = 0.02 + 0.98 * t;
  return {
    r: Math.max(t > 0 ? 1 : 0, Math.round(hue.r * level)),
    g: Math.round(hue.g * level),
    b: Math.round(hue.b * level)
  };
}

function stop(espMac) {
  const current = running.get(espMac);
  if (!current) return false;
  current.cancelled = true;
  clearTimeout(current.timer);
  running.delete(espMac);
  return true;
}

// Roda a rampa em um dispositivo. Não espera o fim: devolve na hora e segue
// em background, cancelável por stop().
function start(espMac, durationMin = 20) {
  stop(espMac); // uma rampa por dispositivo

  const totalMs = durationMin * 60 * 1000;
  const steps = Math.max(1, Math.round(totalMs / STEP_MS));
  const state = { timer: null, cancelled: false };
  running.set(espMac, state);

  logger.info(`Sunrise iniciado em ${espMac}: ${durationMin} min, ${steps} passos`);

  let step = 0;
  const tick = async () => {
    if (state.cancelled) return;

    const t = step / steps;
    const color = colorAt(t);

    try {
      // fadeMs cobre o intervalo: o firmware interpola e a rampa fica contínua.
      await applyColor([espMac], { ...color, fadeMs: STEP_MS });
    } catch (error) {
      logger.warn(`Sunrise falhou em ${espMac}: ${error.message}`);
    }

    step += 1;
    if (step > steps || state.cancelled) {
      running.delete(espMac);
      if (!state.cancelled) logger.info(`Sunrise concluído em ${espMac}`);
      return;
    }

    state.timer = setTimeout(tick, STEP_MS);
  };

  tick();
  return { steps, durationMin };
}

function isRunning(espMac) {
  return running.has(espMac);
}

module.exports = { start, stop, isRunning, colorAt, STEP_MS };
