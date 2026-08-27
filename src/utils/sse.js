const sseClients = new Set();

function addClient(res) {
  sseClients.add(res);
}

function removeClient(res) {
  sseClients.delete(res);
}

function notifyClients(data) {
  const payload = JSON.stringify(data);
  sseClients.forEach((client) => {
    client.write(`event: status\ndata: ${payload}\n\n`);
  });
}

// O padrão vai junto da cor: o card do dashboard mostra a fita inteira, e só
// com a cor representativa um gradiente apareceria como cor sólida.
function notifyClientState(espMac, color, pattern) {
  const payload = JSON.stringify({
    espMac,
    r: color.r, g: color.g, b: color.b, w: color.w || 0,
    ...(pattern ? { pattern } : {})
  });
  sseClients.forEach((client) => {
    client.write(`event: state\ndata: ${payload}\n\n`);
  });
}

function notifyClientEffect(espMac, effect) {
  const payload = JSON.stringify({ espMac, effect });
  sseClients.forEach((client) => {
    client.write(`event: effect\ndata: ${payload}\n\n`);
  });
}

// Progresso do OTA. `phase` é downloading | rebooting | error; durante o flash
// o ESP some da rede por ~30 s, então a UI precisa distinguir "reiniciando" de
// "caiu" para não assustar quem está olhando.
function notifyClientOta(espMac, event) {
  const payload = JSON.stringify({ espMac, ...event });
  sseClients.forEach((client) => {
    client.write(`event: ota\ndata: ${payload}\n\n`);
  });
}

module.exports = {
  addClient,
  removeClient,
  notifyClients,
  notifyClientState,
  notifyClientEffect,
  notifyClientOta
};
