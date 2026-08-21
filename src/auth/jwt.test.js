// Auto-teste da sessão: node src/auth/jwt.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const assert = require('assert');
const { generateToken, checkJWT, sessionCookie, shouldRenew, SESSION_SECONDS } = require('./jwt');

const req = (cookie, headers = {}) => ({ headers: { cookie, ...headers }, socket: {} });
const now = () => Math.floor(Date.now() / 1000);

// --- checkJWT devolve payload ou null ---
const token = generateToken('alice');
assert.strictEqual(checkJWT(req(`token=${token}`)).user, 'alice');
assert.strictEqual(checkJWT(req('')), null, 'sem cookie → null');
assert.strictEqual(checkJWT(req('token=lixo')), null, 'token inválido → null');

// --- shouldRenew: só re-assina na segunda metade da vida ---
assert.strictEqual(shouldRenew({ exp: now() + SESSION_SECONDS }), false, 'recém-emitido não renova');
assert.strictEqual(shouldRenew({ exp: now() + 10 * 24 * 3600 }), true, '10 dias restantes renova');

// --- sessionCookie: persistente, e Secure só atrás de HTTPS ---
const plain = sessionCookie(req(''), token);
assert.ok(plain.includes(`Max-Age=${SESSION_SECONDS}`), 'cookie precisa ser persistente');
assert.ok(plain.includes('HttpOnly') && plain.includes('SameSite=Lax'));
assert.ok(!plain.includes('Secure'), 'HTTP puro não marca Secure');
assert.ok(
  sessionCookie(req('', { 'x-forwarded-proto': 'https' }), token).includes('Secure'),
  'atrás do proxy HTTPS marca Secure'
);

console.log('ok');
