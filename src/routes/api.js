const WebSocket = require('ws');
const { controlPage } = require('../views');
const { isESPConnected, getESPWebSocket } = require('../websocket/espTunnel');
const { addClient, removeClient } = require('../utils/sse');

function handleHome(req, res) {
  res.writeHead(200, { "Content-Type": "text/html; charset=UTF-8" });
  res.end(controlPage);
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

function handleWOL(req, res) {
  const espWebSocket = getESPWebSocket();
  
  // Check ESP connection
  if (!espWebSocket || espWebSocket.readyState !== WebSocket.OPEN) {
    res.writeHead(503, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "ESP offline" }));
  }

  let body = "";
  req.on("data", chunk => body += chunk);

  req.on("end", () => {
    try {
      const { mac } = JSON.parse(body);
      
      if (!mac) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "MAC address required" }));
      }

      // Send command to ESP32
      const command = JSON.stringify({ mac });
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

    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
    }
  });
}

module.exports = {
  handleHome,
  handleStatus,
  handleWOL
};
