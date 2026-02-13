const WebSocket = require('ws');
const logger = require('../utils/logger');
const { validateHMAC, validateTimestamp } = require('../auth/hmac');
const { TUNNEL_PORT } = require('../config');

let espWebSocket = null;
let espConnected = false;
const statusChangeCallbacks = [];

function onStatusChange(callback) {
  statusChangeCallbacks.push(callback);
}

function notifyStatusChange() {
  statusChangeCallbacks.forEach(callback => callback(espConnected));
}

function isESPConnected() {
  return espConnected;
}

function getESPWebSocket() {
  return espWebSocket;
}

function initializeTunnel() {
  const wss = new WebSocket.Server({ port: TUNNEL_PORT });

  wss.on('connection', (ws) => {
    logger.info("Incoming ESP WebSocket connection...");
    
    let authenticated = false;
    let pingInterval = null;
    let authTimeout = setTimeout(() => {
      if (!authenticated) {
        logger.warn("Authentication timeout - no valid auth received in 10s");
        ws.close();
      }
    }, 10000); // 10 segundos para autenticar
    
    // Configurar ping/pong
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (message) => {
      const data = message.toString();
      
      if (!authenticated) {
        try {
          const auth = JSON.parse(data);
          const { token, hmac } = auth;

          logger.debug(`Auth attempt: token="${token}"`);

          if (!token || !hmac) {
            logger.error("Missing token or hmac");
            ws.close();
            return;
          }

          // Valida timestamp primeiro (mais fácil de diagnosticar)
          if (!validateTimestamp(token)) {
            logger.error("Invalid or expired timestamp");
            ws.close();
            return;
          }

          // Valida HMAC
          if (!validateHMAC(token, hmac)) {
            logger.error("Invalid HMAC");
            ws.close();
            return;
          }

          logger.info("ESP authenticated successfully");
          authenticated = true;
          clearTimeout(authTimeout);
          espWebSocket = ws;
          espConnected = true;
          notifyStatusChange();
          
          // Iniciar ping a cada 10 segundos
          pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.isAlive = false;
              ws.ping();
              
              // Verificar se respondeu ao ping anterior
              setTimeout(() => {
                if (!ws.isAlive && ws.readyState === WebSocket.OPEN) {
                  logger.warn("ESP not responding to ping, terminating connection");
                  ws.terminate();
                }
              }, 5000); // 5s para responder
            }
          }, 10000); // ping a cada 10s

        } catch (e) {
          logger.error("Invalid auth JSON:", data);
          logger.error("Error:", e.message);
          ws.close();
        }
      }
    });

    ws.on('close', () => {
      logger.info("ESP disconnected");
      clearTimeout(authTimeout);
      if (pingInterval) clearInterval(pingInterval);
      if (espWebSocket === ws) {
        espWebSocket = null;
        espConnected = false;
        notifyStatusChange();
      }
    });

    ws.on('error', (err) => {
      logger.error("ESP WebSocket error:", err.message);
      clearTimeout(authTimeout);
      if (pingInterval) clearInterval(pingInterval);
      if (espWebSocket === ws) {
        espWebSocket = null;
        espConnected = false;
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
  getESPWebSocket
};
