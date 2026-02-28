const http = require('http');
const logger = require('./utils/logger');
const { HTTP_PORT } = require('./config');
const { checkJWT } = require('./auth/jwt');
const { handleLogin, handleLogout, handleAuth } = require('./routes/auth');
const {
  handleHome,
  handleLEDPage,
  handleConfigPage,
  handleWolTargetsPage,
  handleStatus,
  handleGetClients,
  handleGetDiscoveredClients,
  handleGetWolTargets,
  handleUpsertWolTarget,
  handleUpsertClient,
  handleWOL,
  handleLED
} = require('./routes/api');
const { initializeTunnel, onStatusChange } = require('./websocket/espTunnel');
const { notifyClients } = require('./utils/sse');

// Initialize WebSocket tunnel
initializeTunnel();

// Listen to ESP connection status changes and notify SSE clients
onStatusChange((connectedClients) => {
  notifyClients({ connected: connectedClients.length > 0, connectedClients });
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

  // LED CONTROL PAGE
  if (req.url === "/led" && req.method === "GET") {
    return handleLEDPage(req, res);
  }

  // CONFIG PAGE
  if (req.url === "/config" && req.method === "GET") {
    return handleConfigPage(req, res);
  }

  // WOL TARGETS PAGE
  if (req.url === "/wol-targets" && req.method === "GET") {
    return handleWolTargetsPage(req, res);
  }

  // CLIENTS API
  if (req.url === "/api/clients" && req.method === "GET") {
    return handleGetClients(req, res);
  }

  if (req.url === "/api/clients/discovered" && req.method === "GET") {
    return handleGetDiscoveredClients(req, res);
  }

  if (req.url === "/api/clients" && req.method === "POST") {
    return handleUpsertClient(req, res);
  }

  // WOL TARGETS API
  if (req.url === "/api/wol-targets" && req.method === "GET") {
    return handleGetWolTargets(req, res);
  }

  if (req.url === "/api/wol-targets" && req.method === "POST") {
    return handleUpsertWolTarget(req, res);
  }

  // WAKE-ON-LAN COMMAND
  if (req.url === "/wol" && req.method === "POST") {
    return handleWOL(req, res);
  }

  // LED COMMAND
  if (req.url === "/led" && req.method === "POST") {
    return handleLED(req, res);
  }

  // 404
  res.writeHead(404);
  res.end("Not found");
});

httpServer.listen(HTTP_PORT, () => {
  logger.info(`HTTP server listening on port ${HTTP_PORT}`);
});