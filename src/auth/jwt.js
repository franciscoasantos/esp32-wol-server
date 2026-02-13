const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const { JWT_SECRET } = require('../config');

function generateToken(user) {
  return jwt.sign({ user }, JWT_SECRET, { expiresIn: '2h' });
}

function checkJWT(req) {
  const cookies = cookie.parse(req.headers.cookie || "");
  if (!cookies.token) return false;

  try {
    jwt.verify(cookies.token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  generateToken,
  checkJWT
};
