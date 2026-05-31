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
  saveScene: (payload) => req('POST', '/api/scenes', payload).then((d) => d.scene),
  deleteScene: (id) => req('DELETE', `/api/scenes/${encodeURIComponent(id)}`),

  // Commands (retornam { status, action, okCount, failCount, results })
  sendLed: (payload) => req('POST', '/led', payload),
  sendWol: (payload) => req('POST', '/wol', payload),
  // Efeito roda no firmware do ESP; envia um único comando (effect:'none' para parar)
  sendEffect: (payload) => req('POST', '/effect', payload)
};
