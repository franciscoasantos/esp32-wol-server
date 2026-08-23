// Ritual de acordar o PC: manda o pacote mágico e usa a fita como barra de
// progresso enquanto sonda o alvo. Verde quando ele responde, vermelho no
// timeout, e a fita volta ao que estava.
//
// É o cruzamento que só faz sentido aqui, porque o mesmo dispositivo tem o
// Wake-on-LAN e o LED.

const net = require('net');
const logger = require('../utils/logger');
const { applyColor, applyEffect, sendWol, snapshot, restore } = require('./ledService');

// Portas que um PC acordado costuma abrir. TCP em vez de ICMP porque o Node
// não abre socket raw sem privilégio, e um SYN é mais conclusivo que um ping
// que o firewall pode estar descartando.
const DEFAULT_PORTS = [3389, 445, 22, 139];
const PROBE_TIMEOUT_MS = 900;
const POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 90000;

const PROGRESS_COLOR = { r: 0, g: 120, b: 255 };
const SUCCESS_COLOR = { r: 0, g: 255, b: 60 };
const FAILURE_COLOR = { r: 255, g: 30, b: 0 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Uma porta aberta basta; uma recusa explícita (ECONNREFUSED) também prova que
// a máquina está de pé, então conta como sucesso.
function probePort(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (alive) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(alive);
    };

    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', (error) => finish(error.code === 'ECONNREFUSED'));
    socket.connect(port, host);
  });
}

async function isHostUp(host, ports) {
  const results = await Promise.all(ports.map((port) => probePort(host, port)));
  return results.some(Boolean);
}

// Dispara o ritual. Devolve na hora com o resultado do WoL; a sondagem e a
// animação seguem em background.
async function run({ espMacs, targetMac, host, timeoutMs = DEFAULT_TIMEOUT_MS, ports = DEFAULT_PORTS }) {
  const wolResult = await sendWol(espMacs, targetMac);

  if (!host) {
    // Sem IP/hostname não há como sondar; fica só o pacote mágico.
    return { wol: wolResult, probing: false };
  }

  const states = espMacs.map((mac) => snapshot(mac));

  (async () => {
    // `wipe` preenchendo em azul é a barra de progresso do ritual.
    await applyEffect(espMacs, { effect: 'wipe', color: PROGRESS_COLOR, speed: 60 });

    const deadline = Date.now() + timeoutMs;
    let awake = false;

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      if (await isHostUp(host, ports)) { awake = true; break; }
    }

    logger.info(`Ritual de WoL para ${host}: ${awake ? 'acordou' : 'timeout'}`);

    await applyEffect(espMacs, { effect: 'none' });
    const color = awake ? SUCCESS_COLOR : FAILURE_COLOR;
    for (let i = 0; i < 2; i++) {
      await applyColor(espMacs, { ...color, fadeMs: 0 });
      await sleep(350);
      await applyColor(espMacs, { r: 0, g: 0, b: 0, fadeMs: 0 });
      await sleep(250);
    }

    for (const state of states) {
      await restore(state);
    }
  })().catch((error) => logger.error(`Ritual de WoL falhou: ${error.message}`));

  return { wol: wolResult, probing: true, host, timeoutMs };
}

module.exports = { run, isHostUp, DEFAULT_PORTS };
