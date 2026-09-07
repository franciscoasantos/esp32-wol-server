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
  // Base pública (ex.: https://wol.exemplo.net) usada para montar a URL de
  // download do firmware que o ESP32 recebe no comando de OTA. Sem ela o
  // update fica indisponível — o dispositivo precisa de uma URL alcançável de
  // fora, não do host:porta interno.
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
  // Coordenadas para os gatilhos de nascer/pôr do sol. Sem elas, rotinas
  // desse tipo simplesmente não disparam (as de horário fixo continuam).
  LATITUDE: toFloat(process.env.LATITUDE),
  LONGITUDE: toFloat(process.env.LONGITUDE)
};
