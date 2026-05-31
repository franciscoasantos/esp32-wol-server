// Dispositivos: gestão de ESP32 (com descoberta/onboarding) e alvos WoL.
// Observação: o backend só expõe GET/POST para clients e wol-targets
// (sem DELETE), portanto a UI oferece cadastrar/editar — não excluir.

import { store } from '../store.js';
import { api } from '../api.js';
import { icon, escapeHtml, toast, openModal, node } from '../ui.js';

export async function mount(view) {
  view.innerHTML = `
    <div class="flex flex-col gap-6">
      <div class="flex w-fit gap-1 rounded-xl border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900">
        <button data-tab="esp" class="rounded-lg px-4 py-1.5 text-sm font-medium">ESP32</button>
        <button data-tab="wol" class="rounded-lg px-4 py-1.5 text-sm font-medium">Alvos WoL</button>
      </div>
      <div data-panel></div>
    </div>`;

  const tabs = view.querySelectorAll('[data-tab]');
  const panel = view.querySelector('[data-panel]');
  let active = 'esp';

  function setTab(t) {
    active = t;
    tabs.forEach((b) => {
      const on = b.dataset.tab === t;
      b.classList.toggle('bg-indigo-600', on);
      b.classList.toggle('text-white', on);
      b.classList.toggle('text-zinc-600', !on);
      b.classList.toggle('dark:text-zinc-300', !on);
    });
    if (t === 'esp') renderEsp(); else renderWol();
  }
  tabs.forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });

  /* ------------------------------- ESP ------------------------------ */
  async function renderEsp() {
    panel.innerHTML = `<p class="py-8 text-center text-sm muted">Carregando…</p>`;
    let discovered = [];
    try { discovered = await api.getDiscovered(); } catch (e) {}
    await store.refreshClients().catch(() => {});
    const clients = store.clients;

    panel.innerHTML = `
      <div class="flex flex-col gap-6">
        ${discovered.length ? `
          <section>
            <h2 class="mb-1 flex items-center gap-2 text-sm font-semibold">${icon('signal', 'h-4 w-4')} Descobertos na rede</h2>
            <p class="mb-3 text-xs muted">ESP32 conectados mas ainda não cadastrados.</p>
            <div class="grid gap-2 sm:grid-cols-2">
              ${discovered.map((d) => `
                <div class="card flex items-center gap-3 p-3">
                  <span class="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-emerald-500"></span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-mono text-sm">${escapeHtml(d.espMac)}</p>
                    <p class="truncate text-xs muted">${escapeHtml(d.ip || '')}</p>
                  </div>
                  <button data-register="${escapeHtml(d.espMac)}" class="btn-primary shrink-0">${icon('plus', 'h-4 w-4')} Registrar</button>
                </div>`).join('')}
            </div>
          </section>` : ''}

        <section>
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-sm font-semibold">Cadastrados</h2>
            <button data-add class="btn-ghost">${icon('plus', 'h-4 w-4')} Adicionar manual</button>
          </div>
          <div data-esp-list class="grid gap-3 sm:grid-cols-2"></div>
        </section>
      </div>`;

    const listEl = panel.querySelector('[data-esp-list]');
    if (!clients.length) {
      listEl.innerHTML = `<p class="col-span-full py-8 text-center text-sm muted">Nenhum ESP32 cadastrado ainda.</p>`;
    } else {
      listEl.innerHTML = clients.map((c) => {
        const online = store.isConnected(c.espMac);
        return `
          <div class="card flex items-center gap-3 p-4">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="h-2 w-2 shrink-0 rounded-full ${online ? 'bg-emerald-500' : 'bg-zinc-400'}"></span>
                <h3 class="truncate font-semibold">${escapeHtml(c.nickname)}</h3>
              </div>
              <p class="truncate font-mono text-xs muted">${escapeHtml(c.espMac)}</p>
              <p class="mt-1 text-xs muted">${c.ledType === 'sk6812' ? 'SK6812 · RGBW' : 'WS2812B · RGB'} · ${c.ledCount} LEDs · pino ${c.ledPin}</p>
            </div>
            <button data-edit="${escapeHtml(c.espMac)}" class="btn-subtle shrink-0">${icon('pencil', 'h-4 w-4')}</button>
          </div>`;
      }).join('');
    }

    panel.querySelector('[data-add]').onclick = () => openEspForm(null);
    panel.querySelectorAll('[data-register]').forEach((b) => { b.onclick = () => openEspForm({ espMac: b.dataset.register }); });
    panel.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => openEspForm(store.clientByMac(b.dataset.edit));
    });
  }

  function openEspForm(existing) {
    const isEdit = existing && existing.nickname;
    const c = existing || {};
    const content = node(`
      <div>
        <h3 class="text-lg font-semibold">${isEdit ? 'Editar ESP32' : 'Cadastrar ESP32'}</h3>
        <div class="mt-4 flex flex-col gap-3">
          <div><label class="label">MAC do ESP</label>
            <input data-mac class="field font-mono" placeholder="7C:87:CE:28:09:68" value="${escapeHtml(c.espMac || '')}" ${isEdit ? 'readonly' : ''} /></div>
          <div><label class="label">Nome</label>
            <input data-nick class="field" placeholder="Sala" maxlength="40" value="${escapeHtml(c.nickname || '')}" /></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="label">Qtd. LEDs</label>
              <input data-count type="number" min="1" max="2048" class="field" value="${c.ledCount || 30}" /></div>
            <div><label class="label">Pino (GPIO)</label>
              <input data-pin type="number" min="0" max="48" class="field" value="${c.ledPin ?? 13}" /></div>
          </div>
          <div><label class="label">Tipo de fita</label>
            <select data-type class="field">
              <option value="ws2812b" ${c.ledType !== 'sk6812' ? 'selected' : ''}>WS2812B (RGB)</option>
              <option value="sk6812" ${c.ledType === 'sk6812' ? 'selected' : ''}>SK6812 (RGBW)</option>
            </select></div>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button data-cancel class="btn-ghost">Cancelar</button>
          <button data-ok class="btn-primary">${isEdit ? 'Salvar' : 'Cadastrar'}</button>
        </div>
      </div>`);
    const { close } = openModal(content);
    content.querySelector('[data-cancel]').onclick = close;
    content.querySelector('[data-ok]').onclick = async () => {
      const payload = {
        espMac: content.querySelector('[data-mac]').value.trim(),
        nickname: content.querySelector('[data-nick]').value.trim(),
        ledCount: Number(content.querySelector('[data-count]').value),
        ledPin: Number(content.querySelector('[data-pin]').value),
        ledType: content.querySelector('[data-type]').value
      };
      try {
        await api.upsertClient(payload);
        toast('success', isEdit ? 'ESP32 atualizado' : 'ESP32 cadastrado');
        close();
        renderEsp();
      } catch (e) { toast('error', e.message); }
    };
  }

  /* ------------------------------- WoL ------------------------------ */
  async function renderWol() {
    panel.innerHTML = `<p class="py-8 text-center text-sm muted">Carregando…</p>`;
    let targets = [];
    try { targets = await api.getWolTargets(); } catch (e) { toast('error', e.message); }

    panel.innerHTML = `
      <section>
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold">Alvos WoL</h2>
          <button data-add class="btn-ghost">${icon('plus', 'h-4 w-4')} Novo alvo</button>
        </div>
        <div data-wol-list class="flex flex-col gap-2"></div>
      </section>`;

    const listEl = panel.querySelector('[data-wol-list]');
    if (!targets.length) {
      listEl.innerHTML = `<p class="py-8 text-center text-sm muted">Nenhum alvo cadastrado.</p>`;
    } else {
      listEl.innerHTML = targets.map((t) => `
        <div class="card flex items-center gap-3 p-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800">${icon('wol', 'h-5 w-5')}</span>
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium">${escapeHtml(t.nickname)}</p>
            <p class="truncate font-mono text-xs muted">${escapeHtml(t.mac)}</p>
          </div>
          <button data-edit="${escapeHtml(t.mac)}|${escapeHtml(t.nickname)}" class="btn-subtle shrink-0">${icon('pencil', 'h-4 w-4')}</button>
        </div>`).join('');
    }

    panel.querySelector('[data-add]').onclick = () => openWolForm(null);
    panel.querySelectorAll('[data-edit]').forEach((b) => {
      const [mac, nickname] = b.dataset.edit.split('|');
      b.onclick = () => openWolForm({ mac, nickname });
    });
  }

  function openWolForm(existing) {
    const isEdit = !!existing;
    const t = existing || {};
    const content = node(`
      <div>
        <h3 class="text-lg font-semibold">${isEdit ? 'Editar alvo' : 'Novo alvo WoL'}</h3>
        <div class="mt-4 flex flex-col gap-3">
          <div><label class="label">Nome</label><input data-nick class="field" placeholder="PC do escritório" maxlength="40" value="${escapeHtml(t.nickname || '')}" /></div>
          <div><label class="label">MAC</label><input data-mac class="field font-mono" placeholder="A8:A1:59:98:61:0E" value="${escapeHtml(t.mac || '')}" ${isEdit ? 'readonly' : ''} /></div>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button data-cancel class="btn-ghost">Cancelar</button>
          <button data-ok class="btn-primary">${isEdit ? 'Salvar' : 'Cadastrar'}</button>
        </div>
      </div>`);
    const { close } = openModal(content);
    content.querySelector('[data-cancel]').onclick = close;
    content.querySelector('[data-ok]').onclick = async () => {
      try {
        await api.upsertWolTarget({
          nickname: content.querySelector('[data-nick]').value.trim(),
          mac: content.querySelector('[data-mac]').value.trim()
        });
        toast('success', isEdit ? 'Alvo atualizado' : 'Alvo cadastrado');
        close();
        renderWol();
      } catch (e) { toast('error', e.message); }
    };
  }

  setTab('esp');
  return () => {};
}
