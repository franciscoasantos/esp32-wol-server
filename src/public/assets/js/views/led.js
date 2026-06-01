// Controle de LED simplificado: cor + brilho (principal), branco (sk6812),
// efeitos e cenas/favoritos. Atua sobre a seleção global de dispositivos.

import { store } from '../store.js';
import { api } from '../api.js';
import { icon, escapeHtml, toast, openModal, confirmModal, node } from '../ui.js';
import { createColorControl, toHex } from '../components/colorControl.js';
import { sceneCard } from '../components/sceneCard.js';
import { showResult } from '../components/resultToast.js';

// Cores favoritas fixas (como na versão anterior)
const FAVORITES = ['#FFFFFF', '#FF0000', '#FF7A00', '#FBFF00', '#8BFF00', '#00FF00', '#00D4FF', '#0095FF', '#0022FF', '#6B2CFF', '#EA00FF', '#FF4D94'];

function mixRgb(a, b, f) {
  return { r: Math.round(a.r + (b.r - a.r) * f), g: Math.round(a.g + (b.g - a.g) * f), b: Math.round(a.b + (b.b - a.b) * f) };
}

const EFFECTS = [
  { key: 'breathing', label: 'Respiração', desc: 'Pulsa o brilho suavemente' },
  { key: 'rainbow', label: 'Arco-íris', desc: 'Percorre todas as cores' },
  { key: 'fade', label: 'Transição', desc: 'Alterna entre cores' }
];

export async function mount(view) {
  view.innerHTML = `
    <div data-guard></div>
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div class="flex flex-col gap-6">
        <section class="card p-5">
          <h2 class="mb-4 text-sm font-semibold">Cor</h2>
          <div data-color></div>
          <div class="mt-5">
            <span class="label">Paleta</span>
            <div class="grid grid-cols-10 gap-2" data-tones></div>
            <div class="mt-2 grid grid-cols-12 gap-2" data-favorites></div>
          </div>
        </section>

        <section class="card p-5">
          <h2 class="mb-1 text-sm font-semibold">Efeitos</h2>
          <p class="mb-4 text-xs muted">Rodam no próprio ESP32 — o servidor envia só um comando.</p>
          <div class="grid gap-2 sm:grid-cols-3" data-effects>
            ${EFFECTS.map((e) => `
              <button data-effect="${e.key}" class="surface flex flex-col items-start gap-1 p-3 text-left transition hover:border-indigo-400">
                <span class="text-sm font-medium">${e.label}</span>
                <span class="text-xs muted">${e.desc}</span>
              </button>`).join('')}
          </div>
          <button data-stop class="btn-ghost mt-3 hidden w-full">${icon('x', 'h-4 w-4')} Parar efeito</button>
        </section>
      </div>

      <aside class="card flex flex-col p-5">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-sm font-semibold">Cenas</h2>
          <button data-save class="btn-subtle px-2.5 py-1 text-xs">${icon('plus', 'h-4 w-4')} Salvar atual</button>
        </div>
        <div data-scenes class="flex flex-col gap-2"></div>
      </aside>
    </div>`;

  const guard = view.querySelector('[data-guard]');
  const colorMount = view.querySelector('[data-color]');
  const tonesEl = view.querySelector('[data-tones]');
  const favoritesEl = view.querySelector('[data-favorites]');
  const scenesEl = view.querySelector('[data-scenes]');
  const stopBtn = view.querySelector('[data-stop]');

  let applyTimer = null;
  let effectKey = null;

  const control = createColorControl(colorMount, {
    hasWhite: false,
    onChange: (color) => { if (effectKey) clearEffect(); renderPalette(); scheduleApply(color); }
  });

  function selectedOnline() {
    return store.selectedMacs().filter((m) => store.isConnected(m));
  }

  function anySk6812() {
    return store.selectedClients().some((c) => c.ledType === 'sk6812');
  }

  function refreshGuard() {
    const sel = store.selection.size;
    if (!store.clients.length) {
      guard.innerHTML = `<div class="card mb-6 flex items-center gap-3 p-4 text-sm">
        ${icon('devices', 'h-5 w-5')} Nenhum dispositivo cadastrado.
        <a href="/devices" data-link class="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Adicionar</a></div>`;
    } else if (!sel) {
      guard.innerHTML = `<div class="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
        Selecione ao menos um dispositivo na barra acima para controlar.</div>`;
    } else {
      guard.innerHTML = '';
    }
    control.setWhiteEnabled(anySk6812());
  }

  function scheduleApply(color) {
    const macs = store.selectedMacs();
    if (!macs.length) return;
    clearTimeout(applyTimer);
    applyTimer = setTimeout(async () => {
      try { await api.sendLed({ espMacs: macs, ...color }); }
      catch (e) { toast('error', e.message); }
    }, 140);
  }

  async function applyNow(color) {
    const macs = store.selectedMacs();
    if (!macs.length) { toast('info', 'Selecione um dispositivo'); return; }
    try {
      const res = await api.sendLed({ espMacs: macs, ...color });
      const byMac = Object.fromEntries(store.clients.map((c) => [c.espMac, c]));
      showResult(res, { actionLabel: 'Cor aplicada', clientsByMac: byMac });
    } catch (e) { toast('error', e.message); }
  }

  /* ------------------------------ paleta ---------------------------- */
  // Tons: branco -> cor atual (âncora) -> preto, em 10 amostras.
  // Favoritos: 12 cores fixas. (mesma lógica da versão anterior)
  function hexToRgb(hex) {
    return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
  }

  function pickColor(rgb) {
    clearEffect();
    control.setColor(rgb);
    renderPalette();
    scheduleApply(control.getColor());
  }

  function renderPalette() {
    const anchor = control.getColor();
    const activeHex = toHex(anchor);

    tonesEl.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const rgb = i <= 4
        ? mixRgb({ r: 255, g: 255, b: 255 }, anchor, i / 4)
        : mixRgb(anchor, { r: 0, g: 0, b: 0 }, (i - 4) / 5);
      const hex = toHex(rgb);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `h-6 rounded-lg p-0 border border-black/10 dark:border-white/10${hex === activeHex ? ' ring-2 ring-inset ring-white/70' : ''}`;
      btn.style.background = hex;
      btn.title = hex;
      btn.addEventListener('click', () => pickColor(rgb));
      tonesEl.appendChild(btn);
    }

    favoritesEl.innerHTML = '';
    FAVORITES.forEach((hex) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `h-6 rounded-lg p-0 border border-black/10 dark:border-white/10${hex.toUpperCase() === activeHex ? ' ring-2 ring-inset ring-white/70' : ''}`;
      btn.style.background = hex;
      btn.title = hex;
      btn.addEventListener('click', () => pickColor(hexToRgb(hex)));
      favoritesEl.appendChild(btn);
    });
  }

  /* ------------------------------ efeitos --------------------------- */
  // O efeito roda no firmware do ESP; o servidor envia um único comando.
  function setEffectUI() {
    view.querySelectorAll('[data-effect]').forEach((b) => {
      const active = b.dataset.effect === effectKey;
      b.classList.toggle('border-indigo-500', active);
      b.classList.toggle('bg-indigo-500/10', active);
    });
    stopBtn.classList.toggle('hidden', !effectKey);
  }

  // Limpa só o destaque local (sem rede). Usado quando uma cor sólida assume
  // o controle — o próprio comando /led já interrompe o efeito no ESP.
  function clearEffect() {
    effectKey = null;
    setEffectUI();
  }

  async function startEffect(key) {
    const macs = selectedOnline();
    if (!macs.length) { toast('info', 'Nenhum dispositivo online selecionado'); return; }
    if (effectKey === key) { stopEffect(); return; }
    effectKey = key;
    setEffectUI();
    const c = control.getColor();
    const label = (EFFECTS.find((e) => e.key === key) || {}).label || 'Efeito';
    try {
      const res = await api.sendEffect({ espMacs: macs, effect: key, r: c.r, g: c.g, b: c.b });
      const byMac = Object.fromEntries(store.clients.map((x) => [x.espMac, x]));
      showResult(res, { actionLabel: label, clientsByMac: byMac });
    } catch (e) {
      toast('error', e.message);
      clearEffect();
    }
  }

  async function stopEffect() {
    const wasActive = effectKey;
    clearEffect();
    if (!wasActive) return;
    const macs = selectedOnline();
    if (!macs.length) return;
    try { await api.sendEffect({ espMacs: macs, effect: 'none' }); }
    catch (e) { toast('error', e.message); }
  }

  view.querySelectorAll('[data-effect]').forEach((b) => { b.onclick = () => startEffect(b.dataset.effect); });
  stopBtn.onclick = stopEffect;

  /* ------------------------------ cenas ----------------------------- */
  async function loadScenes() {
    let scenes = [];
    try { scenes = await api.getScenes(); } catch (e) { toast('error', e.message); }
    const byMac = Object.fromEntries(store.clients.map((c) => [c.espMac, c]));
    scenesEl.innerHTML = '';
    if (!scenes.length) {
      scenesEl.innerHTML = `<p class="py-6 text-center text-sm muted">Nenhuma cena salva ainda.<br/>Ajuste a cor e toque em “Salvar atual”.</p>`;
      return;
    }
    scenes.forEach((scene) => {
      scenesEl.appendChild(sceneCard(scene, {
        clientsByMac: byMac,
        onApply: async (s) => {
          clearEffect();
          control.setColor(s.color);
          renderPalette();
          const macs = (s.espMacs && s.espMacs.length) ? s.espMacs : store.selectedMacs();
          if (!macs.length) { toast('info', 'Selecione um dispositivo'); return; }
          try {
            const res = await api.sendLed({ espMacs: macs, ...s.color });
            showResult(res, { actionLabel: `Cena “${s.name}”`, clientsByMac: byMac });
          } catch (e) { toast('error', e.message); }
        },
        onDelete: async (s) => {
          const ok = await confirmModal({ title: 'Excluir cena?', message: `“${s.name}” será removida.`, confirmText: 'Excluir', danger: true });
          if (!ok) return;
          try { await api.deleteScene(s.id); toast('success', 'Cena excluída'); loadScenes(); }
          catch (e) { toast('error', e.message); }
        }
      }));
    });
  }

  view.querySelector('[data-save]').onclick = () => {
    const color = control.getColor();
    const content = node(`
      <div>
        <h3 class="text-lg font-semibold">Salvar cena</h3>
        <p class="mt-1 text-sm muted">Guarda a cor atual e os dispositivos selecionados.</p>
        <div class="mt-4 flex items-center gap-3">
          <span class="h-10 w-10 rounded-lg border border-black/10 dark:border-white/10" style="background:rgb(${color.r},${color.g},${color.b})"></span>
          <input data-name class="field flex-1" placeholder="Nome da cena" maxlength="40" />
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button data-cancel class="btn-ghost">Cancelar</button>
          <button data-ok class="btn-primary">Salvar</button>
        </div>
      </div>`);
    const { close } = openModal(content);
    const input = content.querySelector('[data-name]');
    setTimeout(() => input.focus(), 50);
    content.querySelector('[data-cancel]').onclick = close;
    const save = async () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      try {
        await api.saveScene({ name, color: { r: color.r, g: color.g, b: color.b }, espMacs: store.selectedMacs() });
        toast('success', 'Cena salva');
        close(); loadScenes();
      } catch (e) { toast('error', e.message); }
    };
    content.querySelector('[data-ok]').onclick = save;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  };

  /* ------------------------------ init ------------------------------ */
  await store.refreshClients().catch(() => {});
  // pré-carrega a cor do primeiro selecionado, se houver
  const firstSel = store.selectedClients()[0];
  if (firstSel) {
    const col = store.colorOf(firstSel.espMac);
    if (col) control.setColor(col);
  }
  refreshGuard();
  renderPalette();
  loadScenes();

  const offs = [
    store.on('selection', refreshGuard),
    store.on('clients', () => { refreshGuard(); loadScenes(); }),
    store.on('status', refreshGuard)
  ];

  return () => {
    offs.forEach((off) => off());
    clearTimeout(applyTimer);
    // Não interrompe o efeito ao sair da tela — ele continua rodando no ESP.
    clearEffect();
    control.destroy();
  };
}
