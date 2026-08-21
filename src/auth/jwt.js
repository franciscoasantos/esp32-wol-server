const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const { JWT_SECRET } = require('../config');

const SESSION_DAYS = 30;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

function generateToken(user) {
  return jwt.sign({ user }, JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });
}

// Retorna o payload decodificado (para renovação deslizante) ou null.
function checkJWT(req) {
  const cookies = cookie.parse(req.headers.cookie || "");
  if (!cookies.token) return null;

  try {
    return jwt.verify(cookies.token, JWT_SECRET);
  } catch {
    return null;
  }
}

// ponytail: assume que o proxy reverso envia X-Forwarded-Proto (Caddy/Traefik fazem por
// padrão; nginx precisa de proxy_set_header). Sem ele o cookie só perde o flag Secure —
// continua funcionando.
function sessionCookie(req, token) {
  const https = req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket.encrypted);
  return `token=${token}; HttpOnly; Path=/; Max-Age=${SESSION_SECONDS}; SameSite=Lax${https ? '; Secure' : ''}`;
}

// Re-assina só quando falta menos de metade da vida, em vez de a cada requisição.
function shouldRenew(payload) {
  return payload.exp * 1000 - Date.now() < (SESSION_SECONDS * 1000) / 2;
}

module.exports = {
  generateToken,
  checkJWT,
  sessionCookie,
  shouldRenew,
  SESSION_SECONDS
};
