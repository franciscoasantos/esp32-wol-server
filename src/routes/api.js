const { controlPage, ledPage, configPage, wolTargetsPage } = require('../views');
const {
  normalizeMac,
  getClients,
  getClientByMac,
  upsertClient
} = require('../data/clientsStore');
const { getWolTargets, upsertWolTarget } = require('../data/wolTargetsStore');
const {
  isESPConnected,
  sendCommandToESP,
  getConnectedClients,
  getConnectedClientDetails
} = require('../websocket/espTunnel');
const { addClient, removeClient } = require('../utils/sse');

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (_e) {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function getClientsWithStatus() {
  const connected = new Set(getConnectedClients());
  return getClients().map((client) => ({
    ...client,
    connected: connected.has(client.espMac)
  }));
}

function handleHome(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
  res.end(controlPage);
}

function handleLEDPage(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
  res.end(ledPage);
}

function handleConfigPage(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
  res.end(configPage);
}

function handleWolTargetsPage(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
  res.end(wolTargetsPage);
}

function handleStatus(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  const connectedClients = getConnectedClients();
  const initialStatus = JSON.stringify({
    connected: connectedClients.length > 0,
    connectedClients
  });

  res.write(`event: status\ndata: ${initialStatus}\n\n`);
  addClient(res);

  req.on('close', () => {
    removeClient(res);
  });
}

function handleGetClients(_req, res) {
  return sendJson(res, 200, { clients: getClientsWithStatus() });
}

function handleGetDiscoveredClients(_req, res) {
  const registered = new Set(getClients().map((client) => client.espMac));
  const discovered = getConnectedClientDetails().filter((item) => !registered.has(item.espMac));
  return sendJson(res, 200, { discovered });
}

function handleGetWolTargets(_req, res) {
  return sendJson(res, 200, { targets: getWolTargets() });
}

async function handleUpsertWolTarget(req, res) {
  try {
    const body = await parseJsonBody(req);
    const saved = upsertWolTarget(body);
    return sendJson(res, 200, { target: saved });
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

async function handleUpsertClient(req, res) {
  try {
    const body = await parseJsonBody(req);
    const saved = upsertClient(body);
    return sendJson(res, 200, { client: { ...saved, connected: isESPConnected(saved.espMac) } });
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

function parseRgb(body) {
  const { r, g, b } = body;
  const values = [r, g, b];
  const valid = values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255);

  if (!valid) {
    throw new Error('RGB values must be integers between 0 and 255');
  }

  return { r, g, b };
}

function parseEspTargets(body) {
  const raw = Array.isArray(body?.espMacs)
    ? body.espMacs
    : (body?.espMac ? [body.espMac] : []);

  const targets = [...new Set(raw
    .map((value) => normalizeMac(value))
    .filter(Boolean))];

  if (!targets.length) {
    throw new Error('espMac/espMacs é obrigatório');
  }

  return targets;
}

function buildResultSummary(action, results) {
  const okCount = results.filter((item) => item.ok).length;
  const failCount = results.length - okCount;

  return {
    status: okCount > 0 ? 'ok' : 'error',
    action,
    okCount,
    failCount,
    results
  };
}

async function handleWOL(req, res) {
  try {
    const body = await parseJsonBody(req);
    const targets = parseEspTargets(body);

    const explicitMac = body?.mac ? normalizeMac(body.mac) : null;
    if (body?.mac && !explicitMac) {
      return sendJson(res, 400, { error: 'MAC alvo inválido' });
    }

    const targetMacFromList = body?.targetMac ? normalizeMac(body.targetMac) : null;
    if (body?.targetMac && !targetMacFromList) {
      return sendJson(res, 400, { error: 'MAC alvo inválido' });
    }

    const results = [];

    for (const espMac of targets) {
      const client = getClientByMac(espMac);
      if (!client) {
        results.push({ espMac, ok: false, error: 'Cliente não encontrado' });
        continue;
      }

      const targetMac = explicitMac || targetMacFromList;
      if (!targetMac) {
        results.push({ espMac, ok: false, error: 'MAC alvo não informado' });
        continue;
      }

      try {
        const response = await sendCommandToESP(espMac, { action: 'wol', mac: targetMac });
        results.push({ espMac, ok: true, response });
      } catch (error) {
        results.push({ espMac, ok: false, error: error.message });
      }
    }

    return sendJson(res, 200, buildResultSummary('wol', results));
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

async function handleLED(req, res) {
  try {
    const body = await parseJsonBody(req);
    const targets = parseEspTargets(body);

    const color = parseRgb(body);

    const results = [];

    for (const espMac of targets) {
      const client = getClientByMac(espMac);
      if (!client) {
        results.push({ espMac, ok: false, error: 'Cliente não encontrado' });
        continue;
      }

      try {
        const response = await sendCommandToESP(espMac, { action: 'led', r: color.r, g: color.g, b: color.b });
        results.push({ espMac, ok: true, response });
      } catch (error) {
        results.push({ espMac, ok: false, error: error.message });
      }
    }

    return sendJson(res, 200, buildResultSummary('led', results));
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

module.exports = {
  handleHome,
  handleLEDPage,
  handleConfigPage,
  handleWolTargetsPage,
  handleStatus,
  handleGetClients,
  handleGetDiscoveredClients,
  handleGetWolTargets,
  handleUpsertWolTarget,
  handleUpsertClient,
  handleWOL,
  handleLED
};
