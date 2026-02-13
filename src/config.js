require('dotenv').config();

module.exports = {
  JWT_SECRET: process.env.JWT_SECRET,
  HMAC_SECRET: process.env.HMAC_SECRET,
  LOGIN_USER: process.env.LOGIN_USER,
  LOGIN_PASS: process.env.LOGIN_PASS,
  TUNNEL_PORT: process.env.TUNNEL_PORT,
  HTTP_PORT: process.env.HTTP_PORT
};
