require('dotenv').config();

const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const WebSocket = require('ws');

const SECRET = process.env.JWT_SECRET;
const HMAC_SECRET = process.env.HMAC_SECRET;
const USER = process.env.LOGIN_USER;
const PASS = process.env.LOGIN_PASS;
const TUNNEL_PORT = process.env.TUNNEL_PORT;
const HTTP_PORT = process.env.HTTP_PORT;

let espWebSocket = null;
let espConnected = false;
const sseClients = new Set();

/* ================= LOGGING ================= */

function log(level, ...args) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${timestamp}] [${level}]`, ...args);
}

const logger = {
  error: (...args) => log('ERROR', ...args),
  warn: (...args) => log('WARN', ...args),
  info: (...args) => log('INFO', ...args),
  debug: (...args) => log('DEBUG', ...args)
};

/* ================= HMAC VALIDATION ================= */

function validateHMAC(token, hmac) {
  const calculatedHMAC = crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(token)
    .digest('hex');

  logger.debug(`HMAC validation: Received=${hmac.substring(0, 16)}..., Expected=${calculatedHMAC.substring(0, 16)}...`);

  return calculatedHMAC === hmac;
}

function validateTimestamp(token) {
  const match = token.match(/esp32-(\d+)/);
  if (!match) {
    logger.error("Token format invalid:", token);
    return false;
  }

  const timestamp = parseInt(match[1]);
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.abs(now - timestamp);

  logger.debug(`Timestamp validation: ESP=${timestamp}, Server=${now}, Diff=${diff}s`);

  // Aceita até 5 minutos de diferença
  if (diff >= 300) {
    logger.warn(`Timestamp difference too large (${diff}s). Check ESP32 NTP sync.`);
    return false;
  }
  
  return true;
}

/* ================= JWT ================= */

function generateToken(user) {
  return jwt.sign({ user }, SECRET, { expiresIn: '2h' });
}

function checkJWT(req) {
  const cookies = cookie.parse(req.headers.cookie || "");
  if (!cookies.token) return false;

  try {
    jwt.verify(cookies.token, SECRET);
    return true;
  } catch {
    return false;
  }
}

/* ================= LOGIN PAGE ================= */

const loginPage = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Login</title>

<style>
* {
  box-sizing: border-box;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
}

body {
  margin: 0;
  background: linear-gradient(135deg, #0f172a, #020617);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
}

.card {
  width: 100%;
  max-width: 380px;
  padding: 28px;
  background: rgba(255,255,255,0.05);
  backdrop-filter: blur(12px);
  border-radius: 14px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.4);
}

h2 {
  margin: 0 0 20px 0;
  text-align: center;
}

input {
  width: 100%;
  padding: 12px;
  margin: 8px 0;
  border-radius: 8px;
  border: none;
  outline: none;
  font-size: 15px;
}

input:focus {
  box-shadow: 0 0 0 2px #4CAF50;
}

button {
  width: 100%;
  padding: 12px;
  margin-top: 14px;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  background: #4CAF50;
  color: white;
  cursor: pointer;
  transition: 0.2s;
}

button:hover {
  background: #43a047;
}

@media (max-width: 420px) {
  body {
    padding: 16px;
  }

  .card {
    padding: 22px;
  }
}
</style>
</head>

<body>
  <form class="card" method="POST" action="/auth">
    <h2>ESP Tunnel Login</h2>
    <input name="user" placeholder="Usuário" required>
    <input name="pass" type="password" placeholder="Senha" required>
    <button>Entrar</button>
  </form>
</body>
</html>
`;

/* ================= CONTROL PAGE ================= */

const controlPage = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Wake-on-LAN Control</title>

<style>
* {
  box-sizing: border-box;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
}

body {
  margin: 0;
  background: linear-gradient(135deg, #0f172a, #020617);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 16px;
}

.container {
  width: 100%;
  max-width: 480px;
}

.card {
  padding: 32px;
  background: rgba(255,255,255,0.05);
  backdrop-filter: blur(12px);
  border-radius: 14px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.4);
}

h1 {
  margin: 0 0 8px 0;
  text-align: center;
  font-size: 26px;
}

.subtitle {
  text-align: center;
  opacity: 0.7;
  margin-bottom: 24px;
  font-size: 14px;
}

.device-info {
  background: rgba(255,255,255,0.08);
  padding: 16px;
  border-radius: 10px;
  margin-bottom: 24px;
}

.device-info label {
  display: block;
  font-size: 12px;
  opacity: 0.7;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.device-info .mac {
  font-family: 'Courier New', monospace;
  font-size: 18px;
  font-weight: 600;
  color: #4CAF50;
}

.esp-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 20px;
  font-size: 14px;
  font-weight: 500;
}

.esp-status.online {
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #4ade80;
}

.esp-status.offline {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #f87171;
}

.status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 20px;
  font-size: 14px;
}

.status.info {
  background: rgba(59, 130, 246, 0.15);
  border: 1px solid rgba(59, 130, 246, 0.3);
  color: #60a5fa;
}

.status.success {
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: #4ade80;
}

.status.error {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #f87171;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

button {
  width: 100%;
  padding: 14px;
  border: none;
  border-radius: 10px;
  font-size: 16px;
  font-weight: 600;
  background: linear-gradient(135deg, #4CAF50, #43a047);
  color: white;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
}

button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(76, 175, 80, 0.4);
}

button:active:not(:disabled) {
  transform: translateY(0);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button .icon {
  margin-right: 8px;
}

.logout {
  margin-top: 16px;
  text-align: center;
}

.logout a {
  color: rgba(255,255,255,0.6);
  text-decoration: none;
  font-size: 14px;
  transition: color 0.2s;
}

.logout a:hover {
  color: rgba(255,255,255,0.9);
}

@media (max-width: 420px) {
  .card {
    padding: 24px;
  }
}
</style>
</head>

<body>
  <div class="container">
    <div class="card">
      <h1>⚡ Wake-on-LAN</h1>
      <p class="subtitle">Controle de dispositivos remotos</p>
      
      <div id="espStatus" class="esp-status offline">
        <div class="status-dot"></div>
        <span id="espStatusText">ESP32: Desconectado</span>
      </div>

      <div class="device-info">
        <label>Endereço MAC</label>
        <div class="mac">A8:A1:59:98:61:0E</div>
      </div>

      <div id="status" class="status info">
        <div class="status-dot"></div>
        <span>Aguardando ação...</span>
      </div>

      <button id="wolBtn" onclick="sendWOL()" disabled>
        <span class="icon">🚀</span>
        Ligar Dispositivo
      </button>

      <div class="logout">
        <a href="/logout">Sair</a>
      </div>
    </div>
  </div>

  <script>
    // Conectar ao SSE para status do ESP
    const eventSource = new EventSource('/api/status');
    
    eventSource.addEventListener('status', (event) => {
      const data = JSON.parse(event.data);
      const espStatus = document.getElementById('espStatus');
      const espStatusText = document.getElementById('espStatusText');
      const wolBtn = document.getElementById('wolBtn');
      
      if (data.connected) {
        espStatus.className = 'esp-status online';
        espStatusText.textContent = 'ESP32: Conectado';
        wolBtn.disabled = false;
      } else {
        espStatus.className = 'esp-status offline';
        espStatusText.textContent = 'ESP32: Desconectado';
        wolBtn.disabled = true;
      }
    });
    
    eventSource.onerror = () => {
      console.error('SSE connection error');
    };

    async function sendWOL() {
      const btn = document.getElementById('wolBtn');
      const status = document.getElementById('status');
      
      btn.disabled = true;
      status.className = 'status info';
      status.innerHTML = '<div class="status-dot"></div><span>Enviando comando...</span>';

      try {
        const response = await fetch('/wol', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mac: 'A8:A1:59:98:61:0E' })
        });

        const data = await response.json();

        if (response.ok && data.status === 'ok') {
          status.className = 'status success';
          status.innerHTML = '<div class="status-dot"></div><span>&#x2705; Comando enviado com sucesso!</span>';
        } else {
          throw new Error(data.error || 'Erro desconhecido');
        }
      } catch (error) {
        status.className = 'status error';
        status.innerHTML = '<div class="status-dot"></div><span>&#x274C; ' + error.message + '</span>';
      } finally {
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>
`;

/* ================= WEBSOCKET TUNNEL ================= */

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

/* ================= SSE STATUS NOTIFICATIONS ================= */

function notifyStatusChange() {
  const statusData = JSON.stringify({ connected: espConnected });
  sseClients.forEach(client => {
    client.write(`event: status\ndata: ${statusData}\n\n`);
  });
}

logger.info(`WebSocket tunnel listening on ${TUNNEL_PORT}`);

/* ================= HTTP SERVER ================= */

const httpServer = http.createServer((req, res) => {

  // LOGIN PAGE
  if (req.url === "/login") {
    res.writeHead(200, { "Content-Type": "text/html; charset=UTF-8" });
    return res.end(loginPage);
  }

  // LOGOUT
  if (req.url === "/logout") {
    res.writeHead(302, {
      "Set-Cookie": "token=; HttpOnly; Path=/; Max-Age=0",
      "Location": "/login"
    });
    return res.end();
  }

  // AUTH
  if (req.url === "/auth" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);

    req.on("end", () => {
      const params = new URLSearchParams(body);
      const user = params.get("user");
      const pass = params.get("pass");

      if (user === USER && pass === PASS) {
        const token = generateToken(user);
        res.writeHead(302, {
          "Set-Cookie": `token=${token}; HttpOnly; Path=/`,
          "Location": "/"
        });
        return res.end();
      }

      res.writeHead(401);
      res.end("Invalid login");
    });

    return;
  }

  // SSE STATUS ENDPOINT (needs auth)
  if (req.url === "/api/status" && req.method === "GET") {
    if (!checkJWT(req)) {
      res.writeHead(401);
      return res.end("Unauthorized");
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Enviar status inicial
    const initialStatus = JSON.stringify({ connected: espConnected });
    res.write(`event: status\ndata: ${initialStatus}\n\n`);

    // Adicionar cliente à lista
    sseClients.add(res);

    // Remover quando desconectar
    req.on('close', () => {
      sseClients.delete(res);
    });

    return;
  }

  // PROTECTED ROUTES
  if (!checkJWT(req)) {
    res.writeHead(302, { Location: "/login" });
    return res.end();
  }

  // CONTROL PAGE
  if (req.url === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=UTF-8" });
    return res.end(controlPage);
  }

  // WAKE-ON-LAN COMMAND
  if (req.url === "/wol" && req.method === "POST") {
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

    return;
  }

  // 404
  res.writeHead(404);
  res.end("Not found");
});

httpServer.listen(HTTP_PORT, () => {
  logger.info(`HTTP listening on ${HTTP_PORT}`);
});