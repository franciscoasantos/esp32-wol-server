// Editor de gradiente: lista de stops (posição 0-255 + cor).
//
// O firmware interpola entre os stops, então o payload é sempre pequeno —
// mandar 589 pixels não passaria pelo buffer de 1 KB do WebSocket.

import { icon } from '../ui.js';

const MAX_STOPS = 8;

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const int = parseInt(m[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function rgbToHex({ r, g, b }) {
  const p = (n) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`.toUpperCase();
}

export function createGradientEditor(container, { onChange } = {}) {
  let stops = [
    { pos: 0, r: 255, g: 120, b: 40 },
    { pos: 255, r: 0, g: 40, b: 255 }
  ];

  container.innerHTML = `
    <div class="flex flex-col gap-3">
      <div data-list class="flex flex-col gap-2"></div>
      <button data-add class="btn-subtle self-start px-2.5 py-1 text-xs">Adicionar cor</button>
    </div>`;

  const listEl = container.querySelector('[data-list]');
  const addBtn = container.querySelector('[data-add]');

  const getStops = () => stops.map((s) => ({ pos: s.pos, r: s.r, g: s.g, b: s.b }));

  function emit() {
    if (onChange) onChange(getStops());
  }

  // O firmware exige ordem crescente de pos: a busca por pixel assume isso.
  function sortStops() {
    stops.sort((a, b) => a.pos - b.pos);
  }

  function render() {
    listEl.innerHTML = '';

    stops.forEach((stop, index) => {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2';
      row.innerHTML = `
        <input data-color type="color" value="${rgbToHex(stop)}"
          class="h-8 w-10 shrink-0 cursor-pointer rounded border border-black/10 bg-transparent p-0 dark:border-white/10" />
        <input data-pos type="range" min="0" max="255" value="${stop.pos}" class="w-full accent-indigo-500" />
        <span data-pos-val class="w-10 shrink-0 text-right text-xs tabular-nums muted">${Math.round(stop.pos / 255 * 100)}%</span>
        <button data-remove class="btn-ghost shrink-0 px-2 py-1 text-xs" ${stops.length <= 2 ? 'disabled' : ''}>
          ${icon('x', 'h-4 w-4')}
        </button>`;

      const colorInput = row.querySelector('[data-color]');
      const posInput = row.querySelector('[data-pos]');
      const posVal = row.querySelector('[data-pos-val]');
      const removeBtn = row.querySelector('[data-remove]');

      colorInput.addEventListener('input', () => {
        Object.assign(stops[index], hexToRgb(colorInput.value));
        emit();
      });

      posInput.addEventListener('input', () => {
        stops[index].pos = Number(posInput.value);
        posVal.textContent = `${Math.round(stops[index].pos / 255 * 100)}%`;
        emit();
      });

      // Reordena só ao soltar: mexer na lista durante o arraste perderia o foco.
      posInput.addEventListener('change', () => {
        sortStops();
        render();
        emit();
      });

      removeBtn.addEventListener('click', () => {
        if (stops.length <= 2) return;
        stops.splice(index, 1);
        render();
        emit();
      });

      listEl.appendChild(row);
    });

    addBtn.disabled = stops.length >= MAX_STOPS;
    addBtn.classList.toggle('opacity-40', stops.length >= MAX_STOPS);
  }

  addBtn.addEventListener('click', () => {
    if (stops.length >= MAX_STOPS) return;
    // Novo stop no meio do maior vão, com a cor interpolada ali.
    let bestGap = -1;
    let insertAt = 1;
    for (let i = 0; i < stops.length - 1; i++) {
      const gap = stops[i + 1].pos - stops[i].pos;
      if (gap > bestGap) { bestGap = gap; insertAt = i + 1; }
    }
    const a = stops[insertAt - 1];
    const b = stops[insertAt];
    stops.splice(insertAt, 0, {
      pos: Math.round((a.pos + b.pos) / 2),
      r: Math.round((a.r + b.r) / 2),
      g: Math.round((a.g + b.g) / 2),
      b: Math.round((a.b + b.b) / 2)
    });
    render();
    emit();
  });

  render();

  return {
    getStops,
    setStops(next) {
      if (!Array.isArray(next) || next.length < 2) return;
      stops = next.slice(0, MAX_STOPS).map((s) => ({
        pos: Math.max(0, Math.min(255, s.pos | 0)),
        r: s.r | 0, g: s.g | 0, b: s.b | 0
      }));
      sortStops();
      render();
    }
  };
}
