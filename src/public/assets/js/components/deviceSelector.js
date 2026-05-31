// Barra global de seleção de dispositivos. Vive no chrome (persistente entre
// views); o roteador apenas mostra/esconde. Sincroniza com o store (SSE).

import { store } from '../store.js';
import { escapeHtml } from '../ui.js';

function swatch(color, effect) {
  // Efeito ativo: bolinha animada (arco-íris para rainbow, cor base pulsando p/ os demais)
  if (effect) {
    const bg = effect === 'rainbow'
      ? 'conic-gradient(red,#ff0,#0f0,#0ff,#00f,#f0f,red)'
      : (color ? `rgb(${color.r},${color.g},${color.b})` : '#6366f1');
    return `<span class="h-3 w-3 shrink-0 animate-pulse rounded-full border border-white/20" style="background:${bg}"></span>`;
  }
  const bg = color ? `rgb(${color.r},${color.g},${color.b})` : 'transparent';
  const border = color ? 'border-white/20' : 'border-zinc-300 dark:border-zinc-600';
  return `<span class="h-3 w-3 shrink-0 rounded-full border ${border}" style="background:${bg}"></span>`;
}

function chip(client) {
  const selected = store.isSelected(client.espMac);
  const online = store.isConnected(client.espMac);
  const cls = selected
    ? 'chip border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
    : 'chip border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:border-zinc-600';
  return `
    <button type="button" data-mac="${escapeHtml(client.espMac)}" class="${cls}" aria-pressed="${selected}">
      <span class="h-2 w-2 shrink-0 rounded-full ${online ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-600'}"></span>
      <span class="max-w-[10rem] truncate">${escapeHtml(client.nickname)}</span>
      ${swatch(store.colorOf(client.espMac), store.effectOf(client.espMac))}
    </button>`;
}

function render(container) {
  const clients = store.clients;
  const count = store.selection.size;

  if (!clients.length) {
    container.innerHTML = `
      <div class="mx-auto flex w-full max-w-5xl items-center gap-2 text-sm muted">
        Nenhum dispositivo cadastrado.
        <a href="/devices" data-link class="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Cadastrar agora</a>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="mx-auto w-full max-w-5xl">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium">Dispositivos</span>
        <span class="rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-300">
          ${count} de ${clients.length}
        </span>
        <div class="ml-auto flex items-center gap-1">
          <button data-act="all" class="btn-subtle px-2.5 py-1 text-xs">Todos</button>
          <button data-act="none" class="btn-subtle px-2.5 py-1 text-xs">Nenhum</button>
        </div>
      </div>
      <div data-chips class="mt-2.5 flex flex-wrap gap-2">
        ${clients.map(chip).join('')}
      </div>
    </div>`;

  container.querySelector('[data-act="all"]').onclick = () => store.selectAll();
  container.querySelector('[data-act="none"]').onclick = () => store.clearSelection();
  container.querySelectorAll('[data-mac]').forEach((btn) => {
    btn.onclick = () => store.toggleSelection(btn.dataset.mac);
  });
}

export function initDeviceBar(container) {
  const rerender = () => render(container);
  rerender();
  const offs = [
    store.on('clients', rerender),
    store.on('selection', rerender),
    store.on('status', rerender),
    store.on('state', rerender),
    store.on('effect', rerender)
  ];
  return () => offs.forEach((off) => off());
}
