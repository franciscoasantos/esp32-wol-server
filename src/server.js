const http = require('http');
const logger = require('./utils/logger');
const { HTTP_PORT } = require('./config');
const { checkJWT } = require('./auth/jwt');
const { handleLogin, handleLogout, handleAuth } = require('./routes/auth');
const {
  handleAppShell,
  handleStatus,
  handleGetClients,
  handleGetDiscoveredClients,
  handleGetWolTargets,
  handleUpsertWolTarget,
  handleUpsertClient,
  handleWOL,
  handleLED,
  handleEffect,
  handleGetScenes,
  handleSaveScene,
  handleDeleteScene
} = require('./routes/api');
const { handleStatic } = require('./utils/static');
const { initializeTunnel, onStatusChange, onStateChange } = require('./websocket/espTunnel');
const { notifyClients, notifyClientState } = require('./utils/sse');
const { getClientByMac, upsertClient } = require('./data/clientsStore');

// Initialize WebSocket tunnel
initializeTunnel();

// Listen to ESP connection status changes and notify SSE clients
onStatusChange((connectedClients) => {
  notifyClients({ connected: connectedClients.length > 0, connectedClients });
});

// Listen to ESP state reports and propagate to browsers + persist
onStateChange((espMac, color) => {
  const client = getClientByMac(espMac);
  if (client) {
    upsertClient({ ...client, lastLedColor: { r: color.r, g: color.g, b: color.b } });
  }
  notifyClientState(espMac, color);
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

  // STATIC ASSETS (public — JS/CSS do SPA)
  if (req.url.startsWith("/assets/") && req.method === "GET") {
    return handleStatic(req, res);
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

  // SPA PAGE ROUTES — todas servem o mesmo shell; o roteador no cliente decide.
  // Mantém /config e /wol-targets como aliases para deep-links antigos.
  if (req.method === "GET" && ["/", "/led", "/wol", "/devices", "/config", "/wol-targets"].includes(req.url)) {
    return handleAppShell(req, res);
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

  // EFFECT COMMAND (efeito roda no firmware do ESP)
  if (req.url === "/effect" && req.method === "POST") {
    return handleEffect(req, res);
  }

  // SCENES API
  if (req.url === "/api/scenes" && req.method === "GET") {
    return handleGetScenes(req, res);
  }

  if (req.url === "/api/scenes" && req.method === "POST") {
    return handleSaveScene(req, res);
  }

  if (req.url.startsWith("/api/scenes/") && req.method === "DELETE") {
    const sceneId = req.url.slice("/api/scenes/".length);
    return handleDeleteScene(req, res, sceneId);
  }

  // 404
  res.writeHead(404);
  res.end("Not found");
});

httpServer.listen(HTTP_PORT, () => {
  logger.info(`HTTP server listening on port ${HTTP_PORT}`);
});