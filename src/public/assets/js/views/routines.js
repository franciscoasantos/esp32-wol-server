// Rotinas: horário fixo ou nascer/pôr do sol disparando uma ação nos ESPs.
//
// O agendador roda no servidor (src/services/scheduler.js) com tick de 30 s,
// então esta tela é só cadastro — nada aqui precisa ficar aberto para a rotina
// disparar.

import { store } from '../store.js';
import { api } from '../api.js';
import { icon, escapeHtml, toast, confirmModal } from '../ui.js';

const TRIGGERS = [
  { key: 'time', label: 'Horário fixo' },
  { key: 'sunrise', label: 'Nascer do sol' },
  { key: 'sunset', label: 'Pôr do sol' }
];

const ACTIONS = [
  { key: 'color', label: 'Cor sólida' },
  { key: 'sunrise', label: 'Despertador (rampa)' },
  { key: 'effect', label: 'Efeito' },
  { key: 'off', label: 'Apagar' }
];

const EFFECT_KEYS = ['breathing', 'rainbow', 'fade', 'fire', 'comet', 'twinkle', 'wave', 'wipe'];
const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function hexToRgb(hex) {
  const int = parseInt(String(hex).replace('#', ''), 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function rgbToHex({ r, g, b }) {
  const p = (n) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`.toUpperCase();
}

function minutesToLabel(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function describeTrigger(schedule) {
  const { trigger, todayMinutes } = schedule;
  const days = trigger.days?.length
    ? trigger.days.map((d) => WEEKDAYS[d]).join('')
    : 'todos os dias';

  if (trigger.type === 'time') return `${trigger.at} · ${days}`;

  const label = trigger.type === 'sunrise' ? 'nascer do sol' : 'pôr do sol';
  const offset = trigger.offsetMin
    ? ` ${trigger.offsetMin > 0 ? '+' : ''}${trigger.offsetMin} min`
    : '';
  // todayMinutes vem calculado do servidor; sem coordenadas ele é null.
  const resolved = todayMinutes === null ? ' (sem coordenadas)' : ` → hoje ${minutesToLabel(todayMinutes)}`;
  return `${label}${offset} · ${days}${resolved}`;
}

function describeAction(action) {
  switch (action.type) {
    case 'color': return `Cor ${rgbToHex(action.color)}`;
    case 'sunrise': return `Despertador, ${action.durationMin} min`;
    case 'effect': return `Efeito ${action.effect}`;
    case 'off': return 'Apagar';
    default: return action.type;
  }
}

export async function mount(view) {
  view.innerHTML = `
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section class="card p-5">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-sm font-semibold">Rotinas</h2>
          <span class="text-xs muted">Rodam no servidor</span>
        </div>
        <div data-list class="flex flex-col gap-2"></div>
      </section>

      <aside class="flex flex-col gap-6">
      <section class="card p-5">
        <h2 class="mb-4 text-sm font-semibold">Nova rotina</h2>
        <div class="flex flex-col gap-3">
          <div>
            <span class="label">Nome</span>
            <input data-name class="field w-full" placeholder="Bom dia" maxlength="40" />
          </div>

          <div>
            <span class="label">Quando</span>
            <select data-trigger class="field w-full">
              ${TRIGGERS.map((t) => `<option value="${t.key}">${t.label}</option>`).join('')}
            </select>
          </div>

          <div data-at-wrap>
            <span class="label">Horário</span>
            <input data-at type="time" value="06:40" class="field w-full" />
          </div>

          <div data-offset-wrap class="hidden">
            <span class="label">Deslocamento (min)</span>
            <input data-offset type="number" value="0" min="-720" max="720" class="field w-full" />
          </div>

          <div>
            <span class="label">Dias</span>
            <div data-days class="flex gap-1">
              ${WEEKDAYS.map((d, i) => `
                <button type="button" data-day="${i}" class="surface h-8 w-8 text-xs font-medium">${d}</button>`).join('')}
            </div>
            <p class="mt-1 text-xs muted">Nenhum selecionado = todos os dias.</p>
          </div>

          <div>
            <span class="label">Fazer o quê</span>
            <select data-action class="field w-full">
              ${ACTIONS.map((a) => `<option value="${a.key}">${a.label}</option>`).join('')}
            </select>
          </div>

          <div data-color-wrap>
            <span class="label">Cor</span>
            <input data-color type="color" value="#FF7A28" class="h-9 w-full cursor-pointer rounded border border-black/10 bg-transparent p-0 dark:border-white/10" />
          </div>

          <div data-duration-wrap class="hidden">
            <span class="label">Duração da rampa (min)</span>
            <input data-duration type="number" value="20" min="1" max="120" class="field w-full" />
          </div>

          <div data-effect-wrap class="hidden">
            <span class="label">Efeito</span>
            <select data-effect class="field w-full">
              ${EFFECT_KEYS.map((k) => `<option value="${k}">${k}</option>`).join('')}
            </select>
          </div>

          <p class="text-xs muted">Aplica nos dispositivos selecionados na barra acima.</p>
          <button data-save class="btn-primary w-full">Criar rotina</button>
        </div>
      </section>

      <section class="card p-5">
        <div class="mb-1 flex items-center justify-between">
          <h2 class="text-sm font-semibold">Modo ausente</h2>
          <label class="flex items-center gap-2 text-xs">
            <input data-away-enabled type="checkbox" class="accent-indigo-500" />
            Ativo
          </label>
        </div>
        <p class="mb-4 text-xs muted">Acende e apaga em intervalos sorteados, para a casa não parecer vazia.</p>

        <div class="flex flex-col gap-3">
          <div class="grid grid-cols-2 gap-2">
            <div>
              <span class="label">Das</span>
              <input data-away-start type="time" class="field w-full" />
            </div>
            <div>
              <span class="label">Até</span>
              <input data-away-end type="time" class="field w-full" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <span class="label">Aceso (min)</span>
              <div class="flex items-center gap-1">
                <input data-away-min-on type="number" min="1" max="240" class="field w-full" />
                <span class="text-xs muted">a</span>
                <input data-away-max-on type="number" min="1" max="240" class="field w-full" />
              </div>
            </div>
            <div>
              <span class="label">Apagado (min)</span>
              <div class="flex items-center gap-1">
                <input data-away-min-off type="number" min="1" max="240" class="field w-full" />
                <span class="text-xs muted">a</span>
                <input data-away-max-off type="number" min="1" max="240" class="field w-full" />
              </div>
            </div>
          </div>

          <div>
            <span class="label">Cor</span>
            <input data-away-color type="color" class="h-9 w-full cursor-pointer rounded border border-black/10 bg-transparent p-0 dark:border-white/10" />
          </div>

          <p data-away-status class="text-xs muted"></p>
          <p class="text-xs muted">Usa os dispositivos selecionados na barra acima ao salvar.</p>
          <button data-away-save class="btn-primary w-full">Salvar modo ausente</button>
        </div>
      </section>
      </aside>
    </div>`;

  const listEl = view.querySelector('[data-list]');
  const nameInput = view.querySelector('[data-name]');
  const triggerSelect = view.querySelector('[data-trigger]');
  const atWrap = view.querySelector('[data-at-wrap]');
  const atInput = view.querySelector('[data-at]');
  const offsetWrap = view.querySelector('[data-offset-wrap]');
  const offsetInput = view.querySelector('[data-offset]');
  const actionSelect = view.querySelector('[data-action]');
  const colorWrap = view.querySelector('[data-color-wrap]');
  const colorInput = view.querySelector('[data-color]');
  const durationWrap = view.querySelector('[data-duration-wrap]');
  const durationInput = view.querySelector('[data-duration]');
  const effectWrap = view.querySelector('[data-effect-wrap]');
  const effectSelect = view.querySelector('[data-effect]');

  const selectedDays = new Set();

  function syncForm() {
    const isTime = triggerSelect.value === 'time';
    atWrap.classList.toggle('hidden', !isTime);
    offsetWrap.classList.toggle('hidden', isTime);

    const action = actionSelect.value;
    colorWrap.classList.toggle('hidden', action !== 'color' && action !== 'effect');
    durationWrap.classList.toggle('hidden', action !== 'sunrise');
    effectWrap.classList.toggle('hidden', action !== 'effect');
  }

  triggerSelect.addEventListener('change', syncForm);
  actionSelect.addEventListener('change', syncForm);
  syncForm();

  view.querySelectorAll('[data-day]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const day = Number(btn.dataset.day);
      if (selectedDays.has(day)) selectedDays.delete(day);
      else selectedDays.add(day);
      btn.classList.toggle('border-indigo-500', selectedDays.has(day));
      btn.classList.toggle('bg-indigo-500/10', selectedDays.has(day));
    });
  });

  function buildAction() {
    const type = actionSelect.value;
    if (type === 'color') return { type, color: hexToRgb(colorInput.value) };
    if (type === 'sunrise') return { type, durationMin: Number(durationInput.value) };
    if (type === 'effect') return { type, effect: effectSelect.value, color: hexToRgb(colorInput.value) };
    return { type: 'off' };
  }

  function buildTrigger() {
    const type = triggerSelect.value;
    const days = [...selectedDays].sort();
    if (type === 'time') return { type, at: atInput.value, days };
    return { type, offsetMin: Number(offsetInput.value), days };
  }

  async function load() {
    let schedules = [];
    try { schedules = await api.getSchedules(); } catch (e) { toast('error', e.message); }

    const byMac = Object.fromEntries(store.clients.map((c) => [c.espMac, c]));
    listEl.innerHTML = '';

    if (!schedules.length) {
      listEl.innerHTML = `<p class="py-8 text-center text-sm muted">Nenhuma rotina ainda.<br/>Crie uma ao lado.</p>`;
      return;
    }

    schedules.forEach((schedule) => {
      const devices = schedule.espMacs
        .map((mac) => byMac[mac]?.nickname || mac)
        .join(', ');

      const row = document.createElement('div');
      row.className = 'surface flex items-center gap-3 p-3';
      row.innerHTML = `
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-sm font-medium">${escapeHtml(schedule.name)}</span>
            ${schedule.ranToday ? '<span class="text-xs muted">· já rodou hoje</span>' : ''}
          </div>
          <div class="truncate text-xs muted">${escapeHtml(describeTrigger(schedule))}</div>
          <div class="truncate text-xs muted">${escapeHtml(describeAction(schedule.action))} · ${escapeHtml(devices)}</div>
        </div>
        <button data-run class="btn-subtle shrink-0 px-2.5 py-1 text-xs">Testar</button>
        <button data-toggle class="btn-subtle shrink-0 px-2.5 py-1 text-xs">${schedule.enabled ? 'Pausar' : 'Ativar'}</button>
        <button data-del class="btn-ghost shrink-0 px-2 py-1">${icon('x', 'h-4 w-4')}</button>`;

      row.querySelector('[data-run]').onclick = async () => {
        try {
          await api.runSchedule(schedule.id);
          toast('success', `"${schedule.name}" disparada`);
        } catch (e) { toast('error', e.message); }
      };

      row.querySelector('[data-toggle]').onclick = async () => {
        try {
          await api.upsertSchedule({ ...schedule, enabled: !schedule.enabled });
          load();
        } catch (e) { toast('error', e.message); }
      };

      row.querySelector('[data-del]').onclick = async () => {
        const ok = await confirmModal({
          title: 'Excluir rotina?',
          message: `"${schedule.name}" será removida.`,
          confirmText: 'Excluir',
          danger: true
        });
        if (!ok) return;
        try { await api.deleteSchedule(schedule.id); toast('success', 'Rotina excluída'); load(); }
        catch (e) { toast('error', e.message); }
      };

      listEl.appendChild(row);
    });
  }

  view.querySelector('[data-save]').onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }

    const espMacs = store.selectedMacs();
    if (!espMacs.length) { toast('info', 'Selecione ao menos um dispositivo'); return; }

    try {
      await api.upsertSchedule({ name, espMacs, trigger: buildTrigger(), action: buildAction() });
      toast('success', 'Rotina criada');
      nameInput.value = '';
      load();
    } catch (e) { toast('error', e.message); }
  };

  /* --------------------------- modo ausente --------------------------- */

  const away = {
    enabled: view.querySelector('[data-away-enabled]'),
    start: view.querySelector('[data-away-start]'),
    end: view.querySelector('[data-away-end]'),
    minOn: view.querySelector('[data-away-min-on]'),
    maxOn: view.querySelector('[data-away-max-on]'),
    minOff: view.querySelector('[data-away-min-off]'),
    maxOff: view.querySelector('[data-away-max-off]'),
    color: view.querySelector('[data-away-color]'),
    status: view.querySelector('[data-away-status]'),
    save: view.querySelector('[data-away-save]')
  };

  function minutesToTime(minutes) {
    const h = String(Math.floor(minutes / 60)).padStart(2, '0');
    const m = String(minutes % 60).padStart(2, '0');
    return `${h}:${m}`;
  }

  function timeToMinutes(value) {
    const [h, m] = String(value || '0:0').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  function renderAway(config) {
    away.enabled.checked = !!config.enabled;
    away.start.value = minutesToTime(config.startMinutes);
    away.end.value = minutesToTime(config.endMinutes);
    away.minOn.value = config.minOnMin;
    away.maxOn.value = config.maxOnMin;
    away.minOff.value = config.minOffMin;
    away.maxOff.value = config.maxOffMin;
    away.color.value = rgbToHex(config.color);

    if (!config.enabled) {
      away.status.textContent = 'Desativado.';
      return;
    }

    const byMac = Object.fromEntries(store.clients.map((c) => [c.espMac, c]));
    const names = (config.espMacs || []).map((mac) => byMac[mac]?.nickname || mac).join(', ');

    if (!config.windowActive) {
      away.status.textContent = `Ativo em ${names || 'nenhum dispositivo'}, mas fora da janela agora.`;
      return;
    }

    const on = (config.devices || []).filter((d) => d.on).length;
    away.status.textContent = `Dentro da janela · ${on} de ${(config.espMacs || []).length} aceso(s) · ${names}`;
  }

  async function loadAway() {
    try { renderAway(await api.getAway()); }
    catch (e) { toast('error', e.message); }
  }

  away.save.onclick = async () => {
    const espMacs = store.selectedMacs();
    if (away.enabled.checked && !espMacs.length) {
      toast('info', 'Selecione ao menos um dispositivo');
      return;
    }

    try {
      const saved = await api.saveAway({
        enabled: away.enabled.checked,
        espMacs,
        startMinutes: timeToMinutes(away.start.value),
        endMinutes: timeToMinutes(away.end.value),
        minOnMin: Number(away.minOn.value),
        maxOnMin: Number(away.maxOn.value),
        minOffMin: Number(away.minOff.value),
        maxOffMin: Number(away.maxOff.value),
        color: hexToRgb(away.color.value)
      });
      renderAway(saved);
      toast('success', away.enabled.checked ? 'Modo ausente ativado' : 'Modo ausente desativado');
    } catch (e) { toast('error', e.message); }
  };

  await store.refreshClients().catch(() => {});
  load();
  loadAway();

  // O estado do modo ausente muda no servidor a cada tick; atualiza de tempos
  // em tempos para o painel não ficar mentindo.
  const awayTimer = setInterval(loadAway, 30000);

  const offs = [store.on('clients', () => { load(); loadAway(); })];
  return () => {
    clearInterval(awayTimer);
    offs.forEach((off) => off());
  };
}
