const WebSocket = require('ws');
const logger = require('../utils/logger');
const { validateHMAC, validateTimestamp } = require('../auth/hmac');
const { TUNNEL_PORT } = require('../config');
const { normalizeMac } = require('../data/clientsStore');
const { getClientByMac } = require('../data/clientsStore');

const clients = new Map();
const clientDetails = new Map();
const statusChangeCallbacks = [];
const commandQueues = new Map();

function formatWsPayload(payload) {
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload);
  } catch (_e) {
    return String(payload);
  }
}

function getConnectedClients() {
  return Array.from(clients.keys());
}

function getConnectedClientDetails() {
  return Array.from(clientDetails.entries()).map(([espMac, details]) => ({
    espMac,
    ip: details.ip
  }));
}

function onStatusChange(callback) {
  statusChangeCallbacks.push(callback);
}

function notifyStatusChange() {
  const connectedClients = getConnectedClients();
  statusChangeCallbacks.forEach((callback) => callback(connectedClients));
}

function isESPConnected(espMac) {
  if (!espMac) {
    return clients.size > 0;
  }

  const normalized = normalizeMac(espMac);
  return normalized ? clients.has(normalized) : false;
}

function getESPWebSocket(espMac) {
  const normalized = normalizeMac(espMac);
  if (!normalized) return null;
  return clients.get(normalized) || null;
}

function enqueueCommand(espMac, operation) {
  const normalized = normalizeMac(espMac);
  if (!normalized) {
    return Promise.resolve({
      status: 'error',
      error: 'MAC inválido'
    });
  }

  const previous = commandQueues.get(normalized) || Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);

  commandQueues.set(normalized, next.finally(() => {
    if (commandQueues.get(normalized) === next) {
      commandQueues.delete(normalized);
    }
  }));

  return next;
}

function sendCommandToESP(espMac, payload, timeoutMs = 5000) {
  return enqueueCommand(espMac, () => new Promise((resolve) => {
    const ws = getESPWebSocket(espMac);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return resolve({ status: 'error', error: 'ESP offline' });
    }

    const cleanupListeners = [];
    let settled = false;

    const cleanup = () => {
      cleanupListeners.forEach((fn) => fn());
      cleanupListeners.length = 0;
    };

    const finishSuccess = (response) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(response);
    };

    const finishError = (message) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ status: 'error', error: message });
    };

    const timeout = setTimeout(() => {
      finishError('ESP timeout');
    }, timeoutMs);

    cleanupListeners.push(() => clearTimeout(timeout));

    const onMessage = (data) => {
      try {
        finishSuccess(JSON.parse(data.toString()));
      } catch (_e) {
        finishError('Invalid ESP response');
      }
    };

    const onSocketClosed = () => {
      finishError('ESP offline');
    };

    ws.once('message', onMessage);
    ws.once('close', onSocketClosed);
    ws.once('error', onSocketClosed);

    cleanupListeners.push(() => ws.removeListener('message', onMessage));
    cleanupListeners.push(() => ws.removeListener('close', onSocketClosed));
    cleanupListeners.push(() => ws.removeListener('error', onSocketClosed));

    logger.debug(`[WS TX][${espMac}] ${formatWsPayload(payload)}`);
    ws.send(JSON.stringify(payload), (error) => {
      if (error) {
        finishError('ESP offline');
      }
    });
  }));
}

function normalizeIp(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.startsWith('::ffff:')) return value.slice(7);
  return value;
}

function initializeTunnel() {
  const wss = new WebSocket.Server({ port: TUNNEL_PORT });

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
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (message) => {
      const data = message.toString();

      if (authenticated) {
        logger.debug(`[WS RX][${authenticatedMac}] ${data}`);

        try {
          const payload = JSON.parse(data);
          if (payload?.action === 'get_config') {
            const clientConfig = getClientByMac(authenticatedMac);
            const ledType = clientConfig?.ledType === 'sk6812' ? 'sk6812' : 'ws2812b';

            if (!clientConfig || !Number.isInteger(clientConfig.ledCount) || !Number.isInteger(clientConfig.ledPin) || !ledType) {
              const errorResponse = {
                status: 'error',
                action: 'config',
                error: 'config_incomplete'
              };
              logger.debug(`[WS TX][${authenticatedMac}] ${formatWsPayload(errorResponse)}`);
              ws.send(JSON.stringify(errorResponse));
              return;
            }

            const configResponse = {
              status: 'ok',
              action: 'config',
              ledCount: clientConfig.ledCount,
              ledPin: clientConfig.ledPin,
              ledType
            };
            logger.debug(`[WS TX][${authenticatedMac}] ${formatWsPayload(configResponse)}`);
            ws.send(JSON.stringify(configResponse));
            return;
          }
        } catch (_e) {
          logger.warn(`Mensagem autenticada inválida de ${authenticatedMac}`);
        }

        return;
      }

      logger.debug(`[WS RX][UNAUTH] ${data}`);

      try {
        const auth = JSON.parse(data);
        const { token, hmac, mac } = auth;
        const normalizedMac = normalizeMac(mac);

        logger.debug(`Auth attempt: token="${token}"`);

        if (!token || !hmac || !normalizedMac) {
          logger.error('Missing/invalid token, hmac or mac');
          ws.close();
          return;
        }

        if (!validateTimestamp(token)) {
          logger.error('Invalid or expired timestamp');
          ws.close();
          return;
        }

        if (!validateHMAC(token, hmac)) {
          logger.error('Invalid HMAC');
          ws.close();
          return;
        }

        logger.info(`ESP authenticated successfully: ${normalizedMac}`);
        authenticated = true;
        authenticatedMac = normalizedMac;
        clearTimeout(authTimeout);

        const previousWs = clients.get(normalizedMac);
        if (previousWs && previousWs !== ws) {
          previousWs.close();
        }

        clients.set(normalizedMac, ws);
        clientDetails.set(normalizedMac, {
          ip: normalizeIp(request?.socket?.remoteAddress)
        });
        notifyStatusChange();

        pingInterval = setInterval(() => {
          if (!ws.isAlive) {
            logger.warn(`ESP not responding to ping, terminating connection: ${normalizedMac}`);
            return ws.terminate();
          }

          ws.isAlive = false;
          ws.ping();
        }, 10000);
      } catch (e) {
        logger.error('Invalid auth JSON:', data);
        logger.error('Error:', e.message);
        ws.close();
      }
    });

    ws.on('close', () => {
      logger.info('ESP disconnected');
      clearTimeout(authTimeout);
      if (pingInterval) clearInterval(pingInterval);

      if (authenticatedMac && clients.get(authenticatedMac) === ws) {
        clients.delete(authenticatedMac);
        clientDetails.delete(authenticatedMac);
        notifyStatusChange();
      }
    });

    ws.on('error', (err) => {
      logger.error('ESP WebSocket error:', err.message);
      clearTimeout(authTimeout);
      if (pingInterval) clearInterval(pingInterval);

      if (authenticatedMac && clients.get(authenticatedMac) === ws) {
        clients.delete(authenticatedMac);
        clientDetails.delete(authenticatedMac);
        notifyStatusChange();
      }
    });
  });

  logger.info(`WebSocket tunnel listening on ${TUNNEL_PORT}`);
}

module.exports = {
  initializeTunnel,
  onStatusChange,
  isESPConnected,
  getESPWebSocket,
  getConnectedClients,
  getConnectedClientDetails,
  sendCommandToESP
};
