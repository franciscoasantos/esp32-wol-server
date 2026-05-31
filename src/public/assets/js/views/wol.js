// Wake-on-LAN: lista pesquisável de alvos, disparo via ESPs selecionados.

import { store } from '../store.js';
import { api } from '../api.js';
import { icon, escapeHtml, toast, openModal, node } from '../ui.js';
import { showResult } from '../components/resultToast.js';

export async function mount(view) {
  view.innerHTML = `
    <div class="flex flex-col gap-5">
      <div data-guard></div>

      <div class="flex items-center gap-2">
        <div class="relative flex-1">
          <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-400">${icon('search', 'h-4 w-4')}</span>
          <input data-search class="field pl-9" placeholder="Buscar alvo por nome ou MAC…" />
        </div>
        <button data-new class="btn-ghost shrink-0">${icon('plus', 'h-4 w-4')} <span class="hidden sm:inline">Novo alvo</span></button>
      </div>

      <div data-list class="flex flex-col gap-2"></div>
    </div>`;

  const guard = view.querySelector('[data-guard]');
  const search = view.querySelector('[data-search]');
  const listEl = view.querySelector('[data-list]');
  let targets = [];

  function selectedOnline() {
    return store.selectedMacs().filter((m) => store.isConnected(m));
  }

  function refreshGuard() {
    const onlineSel = selectedOnline().length;
    const selCount = store.selection.size;
    if (!store.clients.length) {
      guard.innerHTML = banner('amber', 'Cadastre um ESP32 para enviar pacotes WoL.', '/devices', 'Adicionar');
    } else if (!selCount) {
      guard.innerHTML = banner('amber', 'Selecione na barra acima por qual(is) ESP32 enviar o pacote.');
    } else if (!onlineSel) {
      guard.innerHTML = banner('amber', 'Nenhum ESP32 selecionado está online no momento.');
    } else {
      guard.innerHTML = `<div class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
        Enviando via ${onlineSel} ${onlineSel === 1 ? 'dispositivo' : 'dispositivos'} online.</div>`;
    }
  }

  function banner(color, text, href, link) {
    const map = { amber: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' };
    return `<div class="flex items-center gap-2 rounded-xl border p-3 text-sm ${map[color]}">
      ${text} ${href ? `<a href="${href}" data-link class="font-medium underline">${link}</a>` : ''}</div>`;
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const filtered = targets.filter((t) =>
      t.nickname.toLowerCase().includes(q) || t.mac.toLowerCase().includes(q));

    if (!targets.length) {
      listEl.innerHTML = `<div class="card flex flex-col items-center gap-3 p-10 text-center">
        <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-500">${icon('wol', 'h-6 w-6')}</span>
        <p class="font-medium">Nenhum alvo cadastrado</p>
        <p class="text-sm muted">Adicione o MAC do computador que deseja acordar.</p>
        <button data-new2 class="btn-primary mt-1">${icon('plus', 'h-4 w-4')} Novo alvo</button>
      </div>`;
      const b = listEl.querySelector('[data-new2]');
      if (b) b.onclick = openNewTarget;
      return;
    }

    if (!filtered.length) {
      listEl.innerHTML = `<p class="py-8 text-center text-sm muted">Nenhum alvo encontrado para “${escapeHtml(search.value)}”.</p>`;
      return;
    }

    listEl.innerHTML = filtered.map((t) => `
      <div class="card flex items-center gap-3 p-3">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800">${icon('wol', 'h-5 w-5')}</span>
        <div class="min-w-0 flex-1">
          <p class="truncate font-medium">${escapeHtml(t.nickname)}</p>
          <p class="truncate font-mono text-xs muted">${escapeHtml(t.mac)}</p>
        </div>
        <button data-wake="${escapeHtml(t.mac)}" class="btn-primary shrink-0">${icon('power', 'h-4 w-4')} Acordar</button>
      </div>`).join('');

    listEl.querySelectorAll('[data-wake]').forEach((btn) => { btn.onclick = () => wake(btn.dataset.wake); });
  }

  async function wake(targetMac) {
    const espMacs = selectedOnline();
    if (!espMacs.length) { toast('info', 'Selecione ao menos um ESP32 online'); return; }
    try {
      const res = await api.sendWol({ espMacs, targetMac });
      const byMac = Object.fromEntries(store.clients.map((c) => [c.espMac, c]));
      showResult(res, { actionLabel: 'Pacote WoL enviado', clientsByMac: byMac });
    } catch (e) { toast('error', e.message); }
  }

  function openNewTarget() {
    const content = node(`
      <div>
        <h3 class="text-lg font-semibold">Novo alvo WoL</h3>
        <p class="mt-1 text-sm muted">O computador que você quer acordar.</p>
        <div class="mt-4 flex flex-col gap-3">
          <div><label class="label">Nome</label><input data-nick class="field" placeholder="PC do escritório" maxlength="40" /></div>
          <div><label class="label">MAC</label><input data-mac class="field font-mono" placeholder="A8:A1:59:98:61:0E" /></div>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button data-cancel class="btn-ghost">Cancelar</button>
          <button data-ok class="btn-primary">Salvar</button>
        </div>
      </div>`);
    const { close } = openModal(content);
    const nick = content.querySelector('[data-nick]');
    const mac = content.querySelector('[data-mac]');
    setTimeout(() => nick.focus(), 50);
    content.querySelector('[data-cancel]').onclick = close;
    content.querySelector('[data-ok]').onclick = async () => {
      try {
        await api.upsertWolTarget({ nickname: nick.value.trim(), mac: mac.value.trim() });
        toast('success', 'Alvo salvo');
        close();
        targets = await api.getWolTargets();
        render();
      } catch (e) { toast('error', e.message); }
    };
  }

  view.querySelector('[data-new]').onclick = openNewTarget;
  search.addEventListener('input', render);

  await store.refreshClients().catch(() => {});
  try { targets = await api.getWolTargets(); } catch (e) { toast('error', e.message); }
  refreshGuard();
  render();

  const offs = [store.on('selection', refreshGuard), store.on('status', refreshGuard), store.on('clients', refreshGuard)];
  return () => offs.forEach((off) => off());
}
