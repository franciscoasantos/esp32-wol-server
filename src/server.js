const http = require('http');
const logger = require('./utils/logger');
const { HTTP_PORT } = require('./config');
const { checkJWT } = require('./auth/jwt');
const { handleLogin, handleLogout, handleAuth } = require('./routes/auth');
const { handleHome, handleStatus, handleWOL } = require('./routes/api');
const { initializeTunnel, onStatusChange, isESPConnected } = require('./websocket/espTunnel');
const { notifyClients } = require('./utils/sse');

// Initialize WebSocket tunnel
initializeTunnel();

// Listen to ESP connection status changes and notify SSE clients
onStatusChange((connected) => {
  notifyClients({ connected });
});

// HTTP Server
const httpServer = http.createServer((req, res) => {

  // PUBLIC ROUTES
  if (req.url === "/login") {
    return handleLogin(req, res);
  }

  if (req.url === "/logout") {
    return handleLogout(req, res);
  }

  if (req.url === "/auth" && req.method === "POST") {
    return handleAuth(req, res);
  }

  // SSE STATUS ENDPOINT (needs auth)
  if (req.url === "/api/status" && req.method === "GET") {
    if (!checkJWT(req)) {
      res.writeHead(401);
      return res.end("Unauthorized");
    }
    return handleStatus(req, res);
  }

  // PROTECTED ROUTES
  if (!checkJWT(req)) {
    res.writeHead(302, { Location: "/login" });
    return res.end();
  }

  // CONTROL PAGE
  if (req.url === "/" && req.method === "GET") {
    return handleHome(req, res);
  }

  // WAKE-ON-LAN COMMAND
  if (req.url === "/wol" && req.method === "POST") {
    return handleWOL(req, res);
  }

  // 404
  res.writeHead(404);
  res.end("Not found");
});

httpServer.listen(HTTP_PORT, () => {
  logger.info(`HTTP server listening on port ${HTTP_PORT}`);
});