require('dotenv').config();

function toFloat(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

module.exports = {
  JWT_SECRET: process.env.JWT_SECRET,
  HMAC_SECRET: process.env.HMAC_SECRET,
  LOGIN_USER: process.env.LOGIN_USER,
  LOGIN_PASS: process.env.LOGIN_PASS,
  TUNNEL_PORT: process.env.TUNNEL_PORT,
  HTTP_PORT: process.env.HTTP_PORT,
  // Coordenadas para os gatilhos de nascer/pôr do sol. Sem elas, rotinas
  // desse tipo simplesmente não disparam (as de horário fixo continuam).
  LATITUDE: toFloat(process.env.LATITUDE),
  LONGITUDE: toFloat(process.env.LONGITUDE)
};
