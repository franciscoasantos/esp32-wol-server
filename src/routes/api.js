const WebSocket = require('ws');
const { controlPage, ledPage } = require('../views');
const { isESPConnected, getESPWebSocket } = require('../websocket/espTunnel');
const { addClient, removeClient } = require('../utils/sse');

function handleHome(req, res) {
  res.writeHead(200, { "Content-Type": "text/html; charset=UTF-8" });
  res.end(controlPage);
}

function handleLEDPage(req, res) {
  res.writeHead(200, { "Content-Type": "text/html; charset=UTF-8" });
  res.end(ledPage);
}

function handleStatus(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // Enviar status inicial
  const initialStatus = JSON.stringify({ connected: isESPConnected() });
  res.write(`event: status\ndata: ${initialStatus}\n\n`);

  // Adicionar cliente à lista
  addClient(res);

  // Remover quando desconectar
  req.on('close', () => {
    removeClient(res);
  });
}

function sendCommandToESP(res, payload) {
  // Verificar se ESP está conectado e autenticado
  if (!isESPConnected()) {
    res.writeHead(503, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "ESP offline" }));
  }
  
  const espWebSocket = getESPWebSocket();
  
  // Verificar estado do WebSocket
  if (!espWebSocket || espWebSocket.readyState !== WebSocket.OPEN) {
    res.writeHead(503, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "ESP offline" }));
  }

  // Send command to ESP32
  const command = JSON.stringify(payload);
  espWebSocket.send(command);

  // Wait for response from ESP32
  const timeout = setTimeout(() => {
    res.writeHead(504, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "ESP timeout" }));
  }, 5000);

  espWebSocket.once('message', (data) => {
    clearTimeout(timeout);
    try {
      const response = JSON.parse(data.toString());
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid ESP response" }));
    }
  });
}

function handleWOL(req, res) {
  let body = "";
  req.on("data", chunk => body += chunk);

  req.on("end", () => {
    try {
      const { mac } = JSON.parse(body);

      if (!mac) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "MAC address required" }));
      }

      return sendCommandToESP(res, { action: "wol", mac });
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
    }
  });
}

function handleLED(req, res) {
  let body = "";
  req.on("data", chunk => body += chunk);

  req.on("end", () => {
    try {
      const { r, g, b } = JSON.parse(body);

      const values = [r, g, b];
      const isValid = values.every(v => Number.isInteger(v) && v >= 0 && v <= 255);
      if (!isValid) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "RGB values must be integers between 0 and 255" }));
      }

      return sendCommandToESP(res, { action: "led", r, g, b });
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
    }
  });
}

module.exports = {
  handleHome,
  handleLEDPage,
  handleStatus,
  handleWOL,
  handleLED
};
