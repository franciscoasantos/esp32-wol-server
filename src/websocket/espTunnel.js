const WebSocket = require('ws');
const logger = require('../utils/logger');
const { validateHMAC, validateTimestamp } = require('../auth/hmac');
const { TUNNEL_PORT } = require('../config');
const { normalizeMac, getClientByMac, setFirmwareVersion } = require('../data/clientsStore');

const clients = new Map();          // espMac → ws
const clientDetails = new Map();    // espMac → { ip, version }
const pendingResolvers = new Map(); // espMac → (response) => void
const statusChangeCallbacks = [];
const stateChangeCallbacks = [];
const otaCallbacks = [];
const commandQueues = new Map();
let tunnelServer = null;

function formatWsPayload(payload) {
  if (typeof payload === 'string') return payload;
  try { return JSON.stringify(payload); } catch (_e) { return String(payload); }
}

function getConnectedClients() { return Array.from(clients.keys()); }

function getConnectedClientDetails() {
  return Array.from(clientDetails.entries()).map(([espMac, d]) => ({
    espMac,
    ip: d.ip,
    version: d.version || null
  }));
}

function getFirmwareVersion(espMac) {
  const normalized = normalizeMac(espMac);
  return normalized ? (clientDetails.get(normalized)?.version || null) : null;
}

function onStatusChange(cb) { statusChangeCallbacks.push(cb); }
function onStateChange(cb) { stateChangeCallbacks.push(cb); }
function onOtaEvent(cb) { otaCallbacks.push(cb); }

function notifyOtaEvent(espMac, event) {
  otaCallbacks.forEach((cb) => cb(espMac, event));
}

function notifyStatusChange() {
  const connected = getConnectedClients();
  statusChangeCallbacks.forEach((cb) => cb(connected));
}

function notifyStateChange(espMac, color) {
  stateChangeCallbacks.forEach((cb) => cb(espMac, color));
}

function isESPConnected(espMac) {
  if (!espMac) return clients.size > 0;
  const normalized = normalizeMac(espMac);
  return normalized ? clients.has(normalized) : false;
}

function getESPWebSocket(espMac) {
  const normalized = normalizeMac(espMac);
  return normalized ? (clients.get(normalized) || null) : null;
}

function resolveAndClear(espMac, response) {
  const resolve = pendingResolvers.get(espMac);
  if (resolve) {
    pendingResolvers.delete(espMac);
    resolve(response);
  }
}

function enqueueCommand(espMac, operation) {
  const normalized = normalizeMac(espMac);
  if (!normalized) return Promise.resolve({ status: 'error', error: 'MAC inválido' });

  const previous = commandQueues.get(normalized) || Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);

  commandQueues.set(normalized, next.finally(() => {
    if (commandQueues.get(normalized) === next) commandQueues.delete(normalized);
  }));

  return next;
}

function sendCommandToESP(espMac, payload, timeoutMs = 5000) {
  return enqueueCommand(espMac, () => new Promise((resolve) => {
    const normalized = normalizeMac(espMac);
    const ws = normalized ? clients.get(normalized) : null;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return resolve({ status: 'error', error: 'ESP offline' });
    }

    const resolver = (response) => {
      clearTimeout(timeout);
      resolve(response);
    };

    const timeout = setTimeout(() => {
      if (pendingResolvers.get(normalized) === resolver) {
        pendingResolvers.delete(normalized);
        resolve({ status: 'error', error: 'ESP timeout' });
      }
    }, timeoutMs);

    pendingResolvers.set(normalized, resolver);

    logger.debug(`[WS TX][${espMac}] ${formatWsPayload(payload)}`);
    ws.send(JSON.stringify(payload), (error) => {
      if (error) {
        if (pendingResolvers.get(normalized) === resolver) {
          pendingResolvers.delete(normalized);
          clearTimeout(timeout);
          resolve({ status: 'error', error: 'ESP offline' });
        }
      }
    });
  }));
}

function handleGetConfig(ws, espMac) {
  const clientConfig = getClientByMac(espMac);
  const ledType = clientConfig?.ledType === 'sk6812' ? 'sk6812' : 'ws2812b';

  if (!clientConfig || !Number.isInteger(clientConfig.ledCount) || !Number.isInteger(clientConfig.ledPin) || !ledType) {
    const errRes = { status: 'error', action: 'config', error: 'config_incomplete' };
    logger.debug(`[WS TX][${espMac}] ${formatWsPayload(errRes)}`);
    ws.send(JSON.stringify(errRes));
    return;
  }

  const configRes = {
    status: 'ok',
    action: 'config',
    ledCount: clientConfig.ledCount,
    ledPin: clientConfig.ledPin,
    ledType,
    ...(clientConfig.lastLedColor ? { lastLedColor: clientConfig.lastLedColor } : {}),
    // Sem isto, reconectar com um gradiente na fita jogaria uma cor sólida
    // por cima do que o firmware acabou de restaurar da NVS.
    ...(clientConfig.lastPattern ? { lastPattern: clientConfig.lastPattern } : {})
  };
  logger.debug(`[WS TX][${espMac}] ${formatWsPayload(configRes)}`);
  ws.send(JSON.stringify(configRes));
}

function handleStateReport(espMac, payload) {
  const r = payload?.r, g = payload?.g, b = payload?.b, w = payload?.w;
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return;
  logger.debug(`[STATE][${espMac}] r=${r} g=${g} b=${b} w=${w || 0}`);
  notifyStateChange(espMac, { r, g, b, w: w || 0 });
}

// O firmware manda ota_progress/ota_result por conta própria, sem ninguém ter
// pedido. Sem tratá-los antes do resolveAndClear, eles resolveriam por engano o
// comando que estivesse em voo — só existe um resolver por MAC.
function handleOtaProgress(espMac, payload) {
  const pct = payload?.pct;
  if (typeof pct !== 'number' || pct < 0 || pct > 100) return;
  logger.debug(`[OTA][${espMac}] ${pct}%`);
  notifyOtaEvent(espMac, { phase: 'downloading', pct });
}

function handleOtaResult(espMac, payload) {
  if (payload?.status === 'ok') {
    logger.info(`[OTA][${espMac}] completed; device is rebooting`);
    notifyOtaEvent(espMac, { phase: 'rebooting', pct: 100 });
    return;
  }

  const error = payload?.error || 'unknown';
  logger.error(`[OTA][${espMac}] failed: ${error}`);
  notifyOtaEvent(espMac, { phase: 'error', error });
}

function normalizeIp(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.startsWith('::ffff:')) return value.slice(7);
  return value;
}

function initializeTunnel() {
  if (tunnelServer) return tunnelServer;

  const wss = new WebSocket.Server({ port: TUNNEL_PORT });
  tunnelServer = wss;

  wss.on('connection', (ws, request) => {
    logger.info('Incoming ESP WebSocket connection...');

    let authenticated = false;
    let authenticatedMac = null;
    let pingInterval = null;

    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        logger.warn('Authentication timeout - no valid auth received in 10s');
        ws.close();
      }
    }, 10000);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
      const data = message.toString();

      if (!authenticated) {
        logger.debug(`[WS RX][UNAUTH] ${data}`);
        try {
          const auth = JSON.parse(data);
          // `version` só existe a partir do firmware com OTA; ausente em
          // firmwares antigos, que seguem conectando normalmente.
          const { token, hmac, mac, version } = auth;
          const normalizedMac = normalizeMac(mac);

          if (!token || !hmac || !normalizedMac) { logger.error('Missing/invalid token, hmac or mac'); ws.close(); return; }
          if (!validateTimestamp(token)) { logger.error('Invalid or expired timestamp'); ws.close(); return; }
          if (!validateHMAC(token, hmac)) { logger.error('Invalid HMAC'); ws.close(); return; }

          const firmwareVersion = (typeof version === 'string' && version.trim()) ? version.trim().slice(0, 64) : null;

          logger.info(`ESP authenticated successfully: ${normalizedMac}${firmwareVersion ? ` (firmware ${firmwareVersion})` : ''}`);
          authenticated = true;
          authenticatedMac = normalizedMac;
          clearTimeout(authTimeout);

          const previousWs = clients.get(normalizedMac);
          if (previousWs && previousWs !== ws) previousWs.close();

          clients.set(normalizedMac, ws);
          clientDetails.set(normalizedMac, {
            ip: normalizeIp(request?.socket?.remoteAddress),
            version: firmwareVersion
          });
          if (firmwareVersion) setFirmwareVersion(normalizedMac, firmwareVersion);
          notifyStatusChange();

          pingInterval = setInterval(() => {
            if (!ws.isAlive) {
              logger.warn(`ESP not responding to ping, terminating: ${normalizedMac}`);
              return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
          }, 10000);
        } catch (e) {
          logger.error('Invalid auth JSON:', data, e.message);
          ws.close();
        }
        return;
      }

      // Authenticated message dispatch
      logger.debug(`[WS RX][${authenticatedMac}] ${data}`);

      let payload;
      try { payload = JSON.parse(data); } catch (_e) { logger.warn(`Invalid JSON from ${authenticatedMac}`); return; }

      const action = payload?.action;

      if (action === 'get_config') {
        handleGetConfig(ws, authenticatedMac);
        return;
      }

      if (action === 'state_report') {
        handleStateReport(authenticatedMac, payload);
        return;
      }

      if (action === 'ota_progress') {
        handleOtaProgress(authenticatedMac, payload);
        return;
      }

      if (action === 'ota_result') {
        handleOtaResult(authenticatedMac, payload);
        return;
      }

      // Route to pending command resolver (LED, WoL, etc. responses)
      resolveAndClear(authenticatedMac, payload);
    });

    const onDisconnect = () => {
      clearTimeout(authTimeout);
      if (pingInterval) clearInterval(pingInterval);
      if (authenticatedMac) {
        resolveAndClear(authenticatedMac, { status: 'error', error: 'ESP offline' });
        if (clients.get(authenticatedMac) === ws) {
          clients.delete(authenticatedMac);
          clientDetails.delete(authenticatedMac);
          notifyStatusChange();
        }
      }
    };

    ws.on('close', () => { logger.info('ESP disconnected'); onDisconnect(); });
    ws.on('error', (err) => { logger.error('ESP WebSocket error:', err.message); onDisconnect(); });
  });

  logger.info(`WebSocket tunnel listening on ${TUNNEL_PORT}`);
  return tunnelServer;
}

module.exports = {
  initializeTunnel,
  onStatusChange,
  onStateChange,
  onOtaEvent,
  isESPConnected,
  getESPWebSocket,
  getConnectedClients,
  getConnectedClientDetails,
  getFirmwareVersion,
  sendCommandToESP
};
