// Nascer e pôr do sol a partir de latitude/longitude.
//
// Algoritmo NOAA simplificado — matemática pura, sem API e sem dependência.
// Precisão de ~1 minuto, mais que suficiente para acender uma fita de LED.

const DEG = Math.PI / 180;

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

// Devolve o horário do evento em minutos desde a meia-noite UTC, ou null
// quando o sol não nasce/se põe naquele dia (latitudes polares).
function eventUtcMinutes(date, latitude, longitude, sunrise) {
  const n = dayOfYear(date);
  const lngHour = longitude / 15;
  const t = n + ((sunrise ? 6 : 18) - lngHour) / 24;

  // Anomalia média e longitude verdadeira do sol
  const M = 0.9856 * t - 3.289;
  let L = M + 1.916 * Math.sin(M * DEG) + 0.020 * Math.sin(2 * M * DEG) + 282.634;
  L = (L + 360) % 360;

  // Ascensão reta, ajustada para o mesmo quadrante de L
  let RA = Math.atan(0.91764 * Math.tan(L * DEG)) / DEG;
  RA = (RA + 360) % 360;
  RA += (Math.floor(L / 90) * 90) - (Math.floor(RA / 90) * 90);
  RA /= 15;

  const sinDec = 0.39782 * Math.sin(L * DEG);
  const cosDec = Math.cos(Math.asin(sinDec));

  // 90°50' = disco solar + refração atmosférica
  const zenith = 90.8333;
  const cosH = (Math.cos(zenith * DEG) - sinDec * Math.sin(latitude * DEG)) /
               (cosDec * Math.cos(latitude * DEG));

  if (cosH > 1 || cosH < -1) return null; // sol circumpolar naquele dia

  const H = (sunrise ? 360 - Math.acos(cosH) / DEG : Math.acos(cosH) / DEG) / 15;
  const T = H + RA - 0.06571 * t - 6.622;
  const utc = ((T - lngHour) % 24 + 24) % 24;

  return Math.round(utc * 60);
}

// Horário local (minutos desde a meia-noite) do nascer/pôr do sol naquela data.
function solarEventMinutes(date, latitude, longitude, kind) {
  const utcMinutes = eventUtcMinutes(date, latitude, longitude, kind === 'sunrise');
  if (utcMinutes === null) return null;

  // getTimezoneOffset() é minutos a subtrair do local para chegar no UTC.
  const local = utcMinutes - date.getTimezoneOffset();
  return ((local % 1440) + 1440) % 1440;
}

module.exports = { solarEventMinutes };
