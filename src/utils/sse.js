const sseClients = new Set();

function addClient(res) {
  sseClients.add(res);
}

function removeClient(res) {
  sseClients.delete(res);
}

function notifyClients(data) {
  const statusData = JSON.stringify(data);
  sseClients.forEach(client => {
    client.write(`event: status\ndata: ${statusData}\n\n`);
  });
}

module.exports = {
  addClient,
  removeClient,
  notifyClients
};
