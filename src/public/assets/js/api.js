// Wrapper fino sobre fetch para os endpoints do servidor.
// Mantém os contratos atuais (ver src/routes/api.js) intactos.

async function req(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 401 || res.redirected) {
    // Sessão expirada -> volta ao login
    if (res.url && res.url.includes('/login')) {
      location.href = '/login';
      throw new Error('Sessão expirada');
    }
  }
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  }
  if (!res.ok) {
    const msg = (data && data.error) || `Erro ${res.status}`;
    throw new Error(msg);
  }
  return data || {};
}

export const api = {
  // ESP clients
  getClients: () => req('GET', '/api/clients').then((d) => d.clients || []),
  getDiscovered: () => req('GET', '/api/clients/discovered').then((d) => d.discovered || []),
  upsertClient: (payload) => req('POST', '/api/clients', payload).then((d) => d.client),

  // WoL targets
  getWolTargets: () => req('GET', '/api/wol-targets').then((d) => d.targets || []),
  upsertWolTarget: (payload) => req('POST', '/api/wol-targets', payload).then((d) => d.target),

  // Scenes
  getScenes: () => req('GET', '/api/scenes').then((d) => d.scenes || []),
  // Uma cena guarda um estado por dispositivo; quem aplica e captura é o servidor.
  saveScene: (payload) => req('POST', '/api/scenes', payload).then((d) => d.scene),
  captureScene: (payload) => req('POST', '/api/scenes/capture', payload).then((d) => d.scene),
  applyScene: (id) => req('POST', `/api/scenes/${encodeURIComponent(id)}/apply`),
  renameScene: (id, name) => req('POST', `/api/scenes/${encodeURIComponent(id)}/rename`, { name }),
  reorderScenes: (ids) => req('POST', '/api/scenes/reorder', { ids }).then((d) => d.scenes || []),
  deleteScene: (id) => req('DELETE', `/api/scenes/${encodeURIComponent(id)}`),

  // Commands (retornam { status, action, okCount, failCount, results })
  // fadeMs opcional: o firmware interpola até a cor nova. O seletor ao vivo
  // omite (aplica na hora); cenas mandam algo em torno de 600 ms.
  sendLed: (payload) => req('POST', '/led', payload),
  sendWol: (payload) => req('POST', '/wol', payload),
  // Efeito roda no firmware do ESP; envia um único comando (effect:'none' para parar)
  sendEffect: (payload) => req('POST', '/effect', payload),
  // Padrões estáticos: o firmware interpola/preenche, então o payload é
  // pequeno mesmo numa fita de 589 LEDs.
  // Rampa do nascer do sol sob demanda; { stop: true } interrompe
  sendSunrise: (payload) => req('POST', '/sunrise', payload),
  // Automação
  getSchedules: () => req('GET', '/api/schedules').then((d) => d.schedules || []),
  upsertSchedule: (payload) => req('POST', '/api/schedules', payload).then((d) => d.schedule),
  deleteSchedule: (id) => req('DELETE', `/api/schedules/${encodeURIComponent(id)}`),
  runSchedule: (id) => req('POST', `/api/schedules/${encodeURIComponent(id)}/run`),
  // Pisca uma cor e devolve a fita ao estado anterior
  notify: (payload) => req('POST', '/api/notify', payload),
  // WoL com a fita como barra de progresso enquanto sonda o alvo
  wakeRitual: (payload) => req('POST', '/wol/ritual', payload),
  // Modo ausente
  getAway: () => req('GET', '/api/away').then((d) => d.away),
  saveAway: (payload) => req('POST', '/api/away', payload).then((d) => d.away),
  sendGradient: (payload) => req('POST', '/gradient', payload),
  sendSegments: (payload) => req('POST', '/segments', payload),
};
