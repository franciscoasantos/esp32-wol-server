const { appShell } = require('../views');
const {
  normalizeMac,
  getClients,
  getClientByMac,
  upsertClient,
  setLastLedColor,
  setLastPattern
} = require('../data/clientsStore');
const { getWolTargets, upsertWolTarget } = require('../data/wolTargetsStore');
const { getScenes, saveScene, deleteScene } = require('../data/scenesStore');
const {
  isESPConnected,
  sendCommandToESP,
  getConnectedClients,
  getConnectedClientDetails
} = require('../websocket/espTunnel');
const { addClient, removeClient, notifyClientState, notifyClientEffect } = require('../utils/sse');

// Efeito ativo por dispositivo (em memória). O ESP roda o efeito no firmware e
// não reporta estado de volta, então o servidor é a fonte da verdade aqui.
const activeEffects = new Map(); // espMac -> effect ('breathing' | 'rainbow' | 'fade')

function setActiveEffect(espMac, effect) {
  if (!effect || effect === 'none') {
    activeEffects.delete(espMac);
  } else {
    activeEffects.set(espMac, effect);
  }
  notifyClientEffect(espMac, effect && effect !== 'none' ? effect : null);
}

function getActiveEffect(espMac) {
  return activeEffects.get(espMac) || null;
}

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
    connected: connected.has(client.espMac),
    activeEffect: getActiveEffect(client.espMac)
  }));
}

// Todas as rotas de página servem o mesmo shell SPA; o roteador no cliente
// renderiza a view correta a partir do pathname.
function handleAppShell(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
  res.end(appShell);
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

function parseWhite(body) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, 'w')) {
    return null;
  }

  const white = body?.w;
  if (!Number.isInteger(white) || white < 0 || white > 255) {
    throw new Error('W must be an integer between 0 and 255');
  }

  return white;
}

// Duração da transição no firmware. Ausente ou 0 = aplica na hora, que é o
// que o seletor de cor manda (ele já envia uma cor a cada 140 ms).
function parseFadeMs(body) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, 'fadeMs')) {
    return null;
  }

  const fadeMs = body?.fadeMs;
  if (!Number.isInteger(fadeMs) || fadeMs < 0 || fadeMs > 60000) {
    throw new Error('fadeMs deve ser um inteiro entre 0 e 60000');
  }

  return fadeMs;
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

    const targetMac = explicitMac || targetMacFromList;
    const results = await Promise.all(targets.map(async (espMac) => {
      const client = getClientByMac(espMac);
      if (!client) {
        return { espMac, ok: false, error: 'Cliente não encontrado' };
      }

      if (!targetMac) {
        return { espMac, ok: false, error: 'MAC alvo não informado' };
      }

      try {
        const response = await sendCommandToESP(espMac, { action: 'wol', mac: targetMac });
        if (response?.status === 'error') {
          return { espMac, ok: false, error: response.error || 'Falha na comunicação com ESP' };
        }

        return { espMac, ok: true, response };
      } catch (error) {
        return { espMac, ok: false, error: error.message };
      }
    }));

    return sendJson(res, 200, buildResultSummary('wol', results));
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

function handleGetScenes(_req, res) {
  return sendJson(res, 200, { scenes: getScenes() });
}

async function handleSaveScene(req, res) {
  try {
    const body = await parseJsonBody(req);
    const scene = saveScene(body);
    return sendJson(res, 200, { scene });
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

function handleDeleteScene(req, res, id) {
  try {
    deleteScene(id);
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return sendJson(res, 404, { error: error.message });
  }
}

async function handleLED(req, res) {
  try {
    const body = await parseJsonBody(req);
    const targets = parseEspTargets(body);

    const color = parseRgb(body);
    const white = parseWhite(body);
    const fadeMs = parseFadeMs(body);

    const results = await Promise.all(targets.map(async (espMac) => {
      const client = getClientByMac(espMac);
      if (!client) {
        return { espMac, ok: false, error: 'Cliente não encontrado' };
      }

      try {
        const command = { action: 'led', r: color.r, g: color.g, b: color.b };
        if (client.ledType === 'sk6812' && white !== null) {
          command.w = white;
        }
        if (fadeMs) {
          command.fadeMs = fadeMs;
        }

        const response = await sendCommandToESP(espMac, command);
        if (response?.status === 'error') {
          return { espMac, ok: false, error: response.error || 'Falha na comunicação com ESP' };
        }

        // Usa valores confirmados pelo ESP no ACK (ou fallback para os do request)
        const confirmedColor = {
          r: typeof response?.r === 'number' ? response.r : color.r,
          g: typeof response?.g === 'number' ? response.g : color.g,
          b: typeof response?.b === 'number' ? response.b : color.b
        };
        // Caminho quente: atualiza a cor em memória e grava com debounce, em
        // vez de reescrever clients.json a cada comando.
        setLastLedColor(espMac, confirmedColor);
        // Cor sólida interrompe qualquer efeito ativo (espelha o firmware)
        setActiveEffect(espMac, 'none');
        notifyClientState(espMac, { ...confirmedColor, w: response?.w || 0 });

        return { espMac, ok: true, response };
      } catch (error) {
        return { espMac, ok: false, error: error.message };
      }
    }));

    return sendJson(res, 200, buildResultSummary('led', results));
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

// Cor de um stop/segmento: r/g/b obrigatórios, w opcional.
function parsePatternColor(entry, label) {
  const { r, g, b } = entry || {};
  const valid = [r, g, b].every((value) => Number.isInteger(value) && value >= 0 && value <= 255);
  if (!valid) {
    throw new Error(`${label}: r/g/b devem ser inteiros entre 0 e 255`);
  }

  const color = { r, g, b };
  if (Object.prototype.hasOwnProperty.call(entry, 'w')) {
    if (!Number.isInteger(entry.w) || entry.w < 0 || entry.w > 255) {
      throw new Error(`${label}: w deve ser um inteiro entre 0 e 255`);
    }
    color.w = entry.w;
  }
  return color;
}

const MAX_STOPS = 8;
const MAX_SEGMENTS = 8;

// Gradiente por stops (pos 0-255). O firmware interpola, então o payload não
// cresce com o tamanho da fita — importante para os 589 LEDs da sala.
function parseStops(body) {
  const stops = body?.stops;
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new Error('stops deve ser um array com pelo menos 2 itens');
  }
  if (stops.length > MAX_STOPS) {
    throw new Error(`stops aceita no máximo ${MAX_STOPS} itens`);
  }

  let previous = -1;
  return stops.map((stop, index) => {
    const pos = stop?.pos;
    if (!Number.isInteger(pos) || pos < 0 || pos > 255) {
      throw new Error(`stop ${index}: pos deve ser um inteiro entre 0 e 255`);
    }
    if (pos < previous) {
      throw new Error('stops devem vir em ordem crescente de pos');
    }
    previous = pos;
    return { pos, ...parsePatternColor(stop, `stop ${index}`) };
  });
}

// Trechos da fita com cores próprias; pixel fora de todos fica apagado.
function parseSegments(body, ledCount) {
  const segments = body?.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('segments deve ser um array com pelo menos 1 item');
  }
  if (segments.length > MAX_SEGMENTS) {
    throw new Error(`segments aceita no máximo ${MAX_SEGMENTS} itens`);
  }

  return segments.map((segment, index) => {
    const { from, to } = segment || {};
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
      throw new Error(`segmento ${index}: from/to inválidos`);
    }
    return { from, to, ...parsePatternColor(segment, `segmento ${index}`) };
  });
}

function assertSegmentsFit(segments, ledCount) {
  if (!Number.isInteger(ledCount)) return;
  segments.forEach((segment, index) => {
    if (segment.to >= ledCount) {
      throw new Error(`segmento ${index}: to (${segment.to}) fora da fita de ${ledCount} LEDs`);
    }
  });
}

// Envia um padrão estático (gradiente ou segmentos). Como a cor sólida, ele
// interrompe qualquer efeito ativo no dispositivo.
async function sendPattern(req, res, action, parsePayload, buildCommand) {
  try {
    const body = await parseJsonBody(req);
    const targets = parseEspTargets(body);
    const fadeMs = parseFadeMs(body);
    // Validação do payload acontece uma vez, fora do laço: erro de formato é
    // 422 da requisição inteira, não uma falha por dispositivo.
    const parsed = parsePayload(body);

    const results = await Promise.all(targets.map(async (espMac) => {
      const client = getClientByMac(espMac);
      if (!client) {
        return { espMac, ok: false, error: 'Cliente não encontrado' };
      }

      try {
        const { command, pattern, representative } = buildCommand(parsed, client);
        if (fadeMs) command.fadeMs = fadeMs;

        const response = await sendCommandToESP(espMac, command);
        if (response?.status === 'error') {
          return { espMac, ok: false, error: response.error || 'Falha na comunicação com ESP' };
        }

        setLastPattern(espMac, pattern, representative);
        setActiveEffect(espMac, 'none');
        notifyClientState(espMac, { ...representative, w: representative.w || 0 });

        return { espMac, ok: true, response };
      } catch (error) {
        return { espMac, ok: false, error: error.message };
      }
    }));

    return sendJson(res, 200, buildResultSummary(action, results));
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

function handleGradient(req, res) {
  return sendPattern(req, res, 'gradient', parseStops, (stops) => ({
    command: { action: 'gradient', stops },
    pattern: { type: 'gradient', stops },
    representative: { r: stops[0].r, g: stops[0].g, b: stops[0].b }
  }));
}

function handleSegments(req, res) {
  // O formato é validado uma vez; o limite de índice depende do ledCount de
  // cada ESP, então esse fica no laço e vira erro daquele dispositivo.
  return sendPattern(req, res, 'segments', (body) => parseSegments(body, null), (segments, client) => {
    assertSegmentsFit(segments, client.ledCount);
    return {
      command: { action: 'segments', segments },
      pattern: { type: 'segments', segments },
      representative: { r: segments[0].r, g: segments[0].g, b: segments[0].b }
    };
  });
}
// Os efeitos rodam no firmware; esta lista tem que acompanhar o enum de
// led_controller.h e o dispatch em ws_protocol_commands.c.
const ALLOWED_EFFECTS = new Set([
  'breathing', 'rainbow', 'fade', 'fire', 'comet', 'twinkle', 'wave', 'wipe', 'none'
]);

// Parâmetro 0-100 opcional. Ausente = o firmware usa o padrão do efeito,
// que varia (profundidade no breathing, densidade no twinkle, etc).
function parseEffectParam(body, key) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, key)) {
    return null;
  }

  const value = body?.[key];
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error(`${key} deve ser um inteiro entre 0 e 100`);
  }

  return value;
}

// Envia UM único comando de efeito ao ESP. A animação roda no firmware;
// o servidor não fica mandando frames. effect 'none' interrompe o efeito.
async function handleEffect(req, res) {
  try {
    const body = await parseJsonBody(req);
    const targets = parseEspTargets(body);

    const effect = typeof body?.effect === 'string' ? body.effect.trim().toLowerCase() : '';
    if (!ALLOWED_EFFECTS.has(effect)) {
      return sendJson(res, 422, { error: 'effect inválido' });
    }

    // Cor base opcional (usada por efeitos como breathing/fade)
    let color = null;
    if (['r', 'g', 'b'].every((k) => Object.prototype.hasOwnProperty.call(body || {}, k))) {
      color = parseRgb(body);
    }

    const speed = parseEffectParam(body, 'speed');
    const intensity = parseEffectParam(body, 'intensity');

    const results = await Promise.all(targets.map(async (espMac) => {
      const client = getClientByMac(espMac);
      if (!client) {
        return { espMac, ok: false, error: 'Cliente não encontrado' };
      }

      try {
        const command = { action: 'effect', effect };
        if (color) { command.r = color.r; command.g = color.g; command.b = color.b; }
        if (speed !== null) { command.speed = speed; }
        if (intensity !== null) { command.intensity = intensity; }

        const response = await sendCommandToESP(espMac, command);
        if (response?.status === 'error') {
          return { espMac, ok: false, error: response.error || 'Falha na comunicação com ESP' };
        }
        // Registra o efeito ativo (ou limpa se 'none') e propaga via SSE
        setActiveEffect(espMac, effect);
        return { espMac, ok: true, response };
      } catch (error) {
        return { espMac, ok: false, error: error.message };
      }
    }));

    return sendJson(res, 200, buildResultSummary('effect', results));
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

module.exports = {
  handleAppShell,
  handleStatus,
  handleGetClients,
  handleGetDiscoveredClients,
  handleGetWolTargets,
  handleUpsertWolTarget,
  handleUpsertClient,
  handleWOL,
  handleLED,
  handleEffect,
  handleGradient,
  handleSegments,
  handleGetScenes,
  handleSaveScene,
  handleDeleteScene
};
