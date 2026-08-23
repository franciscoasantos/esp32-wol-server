// Agendador de rotinas. Um tick de 30 s compara o relógio local com o horário
// de cada rotina; sem dependência de cron.
//
// Cada rotina dispara no máximo uma vez por dia: o dia do último disparo fica
// registrado em memória, então reiniciar o servidor pode redisparar uma rotina
// cujo horário já passou dentro da janela do tick.

const logger = require('../utils/logger');
const { getSchedules } = require('../data/schedulesStore');
const { LATITUDE, LONGITUDE } = require('../config');
const { solarEventMinutes } = require('../utils/solar');
const { applyColor, applyEffect, applyPattern } = require('./ledService');
const sunrise = require('./sunrise');
const awayMode = require('./awayMode');

const TICK_MS = 30000;
// Janela de tolerância: com tick de 30 s, um horário pode ser observado com
// algum atraso. Sem isso uma rotina passaria batido se o tick atrasasse.
const WINDOW_MIN = 2;

const lastRun = new Map(); // scheduleId -> 'YYYY-MM-DD'
let timer = null;

function dateKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Minuto do dia em que a rotina deve disparar, ou null se não dá para saber
// (sunrise/sunset sem coordenadas configuradas, ou sol circumpolar).
function triggerMinutes(schedule, now) {
  const { trigger } = schedule;

  if (trigger.type === 'time') {
    const [hours, minutes] = trigger.at.split(':').map(Number);
    return hours * 60 + minutes;
  }

  if (LATITUDE === null || LONGITUDE === null) return null;

  const base = solarEventMinutes(now, LATITUDE, LONGITUDE, trigger.type);
  if (base === null) return null;
  return (((base + (trigger.offsetMin || 0)) % 1440) + 1440) % 1440;
}

async function runAction(schedule) {
  const { espMacs, action } = schedule;

  switch (action.type) {
    case 'color':
      return applyColor(espMacs, { ...action.color, fadeMs: action.fadeMs });

    case 'off':
      return applyColor(espMacs, { r: 0, g: 0, b: 0, fadeMs: 1500 });

    case 'effect':
      return applyEffect(espMacs, {
        effect: action.effect,
        color: action.color || null,
        speed: Number.isInteger(action.speed) ? action.speed : null,
        intensity: Number.isInteger(action.intensity) ? action.intensity : null
      });

    case 'gradient':
      return applyPattern(espMacs, 'gradient', () => ({
        command: { action: 'gradient', stops: action.stops },
        pattern: { type: 'gradient', stops: action.stops },
        representative: { r: action.stops[0].r, g: action.stops[0].g, b: action.stops[0].b }
      }), action.fadeMs);

    case 'sunrise':
      // Uma rampa por dispositivo, cada uma no seu tempo.
      espMacs.forEach((espMac) => sunrise.start(espMac, action.durationMin));
      return { status: 'ok', action: 'sunrise', okCount: espMacs.length, failCount: 0, results: [] };

    default:
      return null;
  }
}

async function tick() {
  const now = new Date();

  // Modo ausente compartilha o mesmo tick: é máquina de estados, não
  // agendamento, mas 30 s de granularidade servem para os dois.
  await awayMode.tick(now).catch((error) => logger.error(`Modo ausente falhou: ${error.message}`));

  const today = dateKey(now);
  const nowMinutes = minutesOfDay(now);
  const weekday = now.getDay();

  for (const schedule of getSchedules()) {
    if (!schedule.enabled) continue;
    if (lastRun.get(schedule.id) === today) continue;

    const days = schedule.trigger.days || [];
    if (days.length && !days.includes(weekday)) continue;

    const target = triggerMinutes(schedule, now);
    if (target === null) continue;

    const delta = nowMinutes - target;
    if (delta < 0 || delta > WINDOW_MIN) continue;

    lastRun.set(schedule.id, today);
    logger.info(`Rotina "${schedule.name}" disparada (${schedule.action.type})`);

    try {
      const result = await runAction(schedule);
      if (result && result.failCount) {
        logger.warn(`Rotina "${schedule.name}": ${result.failCount} dispositivo(s) falharam`);
      }
    } catch (error) {
      logger.error(`Rotina "${schedule.name}" falhou: ${error.message}`);
    }
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
  if (timer.unref) timer.unref();

  const solar = (LATITUDE !== null && LONGITUDE !== null)
    ? `lat=${LATITUDE} lon=${LONGITUDE}`
    : 'sem coordenadas (gatilhos de nascer/pôr do sol desativados)';
  logger.info(`Agendador iniciado, tick de ${TICK_MS / 1000}s — ${solar}`);
}

// Horários calculados de hoje, para a UI mostrar quando cada rotina vai rodar.
function describeToday() {
  const now = new Date();
  return getSchedules().map((schedule) => ({
    id: schedule.id,
    minutes: triggerMinutes(schedule, now),
    ranToday: lastRun.get(schedule.id) === dateKey(now)
  }));
}

module.exports = { start, tick, describeToday, runAction };
