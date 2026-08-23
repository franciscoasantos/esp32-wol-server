const http = require('http');
const logger = require('./utils/logger');
const { HTTP_PORT } = require('./config');
const { checkJWT, generateToken, sessionCookie, shouldRenew } = require('./auth/jwt');
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
  handleGradient,
  handleSegments,
  handleGetScenes,
  handleSaveScene,
  handleDeleteScene,
  handleSunrise,
  handleGetSchedules,
  handleUpsertSchedule,
  handleDeleteSchedule,
  handleRunSchedule,
  handleNotify,
  handleWakeRitual,
  handleApplyScene,
  handleCaptureScene,
  handleRenameScene,
  handleReorderScenes,
  handleGetAway,
  handleSaveAway
} = require('./routes/api');
const { handleStatic } = require('./utils/static');
const { initializeTunnel, onStatusChange, onStateChange } = require('./websocket/espTunnel');
const { notifyClients, notifyClientState } = require('./utils/sse');
const { setLastLedColor } = require('./data/clientsStore');
const scheduler = require('./services/scheduler');

// Initialize WebSocket tunnel
initializeTunnel();

// Rotinas agendadas: tick de 30s comparando o relógio local
scheduler.start();

// Listen to ESP connection status changes and notify SSE clients
onStatusChange((connectedClients) => {
  notifyClients({ connected: connectedClients.length > 0, connectedClients });
});

// Listen to ESP state reports and propagate to browsers + persist
onStateChange((espMac, color) => {
  setLastLedColor(espMac, { r: color.r, g: color.g, b: color.b });
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

  // PWA: manifest e service worker precisam ser públicos e servidos na raiz (escopo /).
  if (req.method === "GET" && (req.url === "/sw.js" || req.url === "/manifest.json")) {
    req.url = "/assets" + req.url;
    return handleStatic(req, res);
  }

  // SESSÃO — renovação deslizante: enquanto o app for aberto, o login nunca expira.
  // setHeader antes do handler é mesclado pelo writeHead que ele chama depois (inclui SSE).
  const session = checkJWT(req);
  if (session && shouldRenew(session)) {
    res.setHeader('Set-Cookie', sessionCookie(req, generateToken(session.user)));
  }

  // SSE STATUS ENDPOINT (needs auth)
  if (req.url === "/api/status" && req.method === "GET") {
    if (!session) {
      res.writeHead(401);
      return res.end("Unauthorized");
    }
    return handleStatus(req, res);
  }

  // PROTECTED ROUTES
  if (!session) {
    res.writeHead(302, { Location: "/login" });
    return res.end();
  }

  // SPA PAGE ROUTES — todas servem o mesmo shell; o roteador no cliente decide.
  // Mantém /config e /wol-targets como aliases para deep-links antigos.
  if (req.method === "GET" && ["/", "/led", "/wol", "/routines", "/devices", "/config", "/wol-targets"].includes(req.url)) {
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

  // PATTERN COMMANDS (gradiente e segmentos; ambos interrompem efeito ativo)
  if (req.url === "/gradient" && req.method === "POST") {
    return handleGradient(req, res);
  }

  if (req.url === "/segments" && req.method === "POST") {
    return handleSegments(req, res);
  }

  // SCENES API
  if (req.url === "/api/scenes" && req.method === "GET") {
    return handleGetScenes(req, res);
  }

  if (req.url === "/api/scenes" && req.method === "POST") {
    return handleSaveScene(req, res);
  }

  if (req.url === "/api/scenes/capture" && req.method === "POST") {
    return handleCaptureScene(req, res);
  }

  if (req.url === "/api/scenes/reorder" && req.method === "POST") {
    return handleReorderScenes(req, res);
  }

  if (req.url.startsWith("/api/scenes/") && req.url.endsWith("/apply") && req.method === "POST") {
    const sceneId = req.url.slice("/api/scenes/".length, -"/apply".length);
    return handleApplyScene(req, res, sceneId);
  }

  if (req.url.startsWith("/api/scenes/") && req.url.endsWith("/rename") && req.method === "POST") {
    const sceneId = req.url.slice("/api/scenes/".length, -"/rename".length);
    return handleRenameScene(req, res, sceneId);
  }

  if (req.url.startsWith("/api/scenes/") && req.method === "DELETE") {
    const sceneId = req.url.slice("/api/scenes/".length);
    return handleDeleteScene(req, res, sceneId);
  }

  // SUNRISE
  if (req.url === "/sunrise" && req.method === "POST") {
    return handleSunrise(req, res);
  }

  // AUTOMATION API
  if (req.url === "/api/schedules" && req.method === "GET") {
    return handleGetSchedules(req, res);
  }

  if (req.url === "/api/schedules" && req.method === "POST") {
    return handleUpsertSchedule(req, res);
  }

  if (req.url.startsWith("/api/schedules/") && req.url.endsWith("/run") && req.method === "POST") {
    const scheduleId = req.url.slice("/api/schedules/".length, -"/run".length);
    return handleRunSchedule(req, res, scheduleId);
  }

  if (req.url.startsWith("/api/schedules/") && req.method === "DELETE") {
    const scheduleId = req.url.slice("/api/schedules/".length);
    return handleDeleteSchedule(req, res, scheduleId);
  }

  if (req.url === "/api/away" && req.method === "GET") {
    return handleGetAway(req, res);
  }

  if (req.url === "/api/away" && req.method === "POST") {
    return handleSaveAway(req, res);
  }

  if (req.url === "/api/notify" && req.method === "POST") {
    return handleNotify(req, res);
  }

  // WAKE RITUAL
  if (req.url === "/wol/ritual" && req.method === "POST") {
    return handleWakeRitual(req, res);
  }

  // 404
  res.writeHead(404);
  res.end("Not found");
});

httpServer.listen(HTTP_PORT, () => {
  logger.info(`HTTP server listening on port ${HTTP_PORT}`);
});