// Card de cena: preview de cor, nome, alvos e ações (aplicar 1-toque / excluir).

import { escapeHtml, icon } from '../ui.js';

export function sceneCard(scene, { onApply, onDelete, clientsByMac = {} }) {
  const { r, g, b } = scene.color || { r: 0, g: 0, b: 0 };
  const css = `rgb(${r},${g},${b})`;
  const macs = Array.isArray(scene.espMacs) ? scene.espMacs : [];
  const names = macs.map((m) => (clientsByMac[m] && clientsByMac[m].nickname) || m);
  const targetLabel = names.length
    ? (names.length <= 2 ? names.join(', ') : `${names.length} dispositivos`)
    : 'Selecionados';

  const el = document.createElement('div');
  el.className = 'card group relative flex flex-col overflow-hidden';
  el.innerHTML = `
    <button data-act="apply" class="flex items-center gap-3 p-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
      <span class="h-12 w-12 shrink-0 rounded-xl border border-black/10 shadow-inner dark:border-white/10" style="background:${css}"></span>
      <span class="min-w-0 flex-1">
        <span class="block truncate font-medium">${escapeHtml(scene.name)}</span>
        <span class="block truncate text-xs muted">${escapeHtml(targetLabel)}</span>
      </span>
      <span class="shrink-0 rounded-lg bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-300">Aplicar</span>
    </button>
    <button data-act="delete" class="absolute right-2 top-2 rounded-lg bg-white/80 p-1.5 text-zinc-400 opacity-0 transition hover:text-red-500 group-hover:opacity-100 dark:bg-zinc-900/80" aria-label="Excluir cena">
      ${icon('trash', 'h-4 w-4')}
    </button>`;

  el.querySelector('[data-act="apply"]').addEventListener('click', () => onApply(scene));
  el.querySelector('[data-act="delete"]').addEventListener('click', (e) => { e.stopPropagation(); onDelete(scene); });
  return el;
}
