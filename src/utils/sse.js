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

function notifyClientState(espMac, color) {
  const payload = JSON.stringify({ espMac, r: color.r, g: color.g, b: color.b, w: color.w || 0 });
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

module.exports = {
  addClient,
  removeClient,
  notifyClients,
  notifyClientState,
  notifyClientEffect
};
