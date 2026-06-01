// Entrypoint: monta o chrome persistente, inicia SSE e o roteador SPA.

import { store } from './store.js';
import { router } from './router.js';
import { icon, themeIcon, toggleTheme, $, $$ } from './ui.js';
import { initDeviceBar } from './components/deviceSelector.js';

import * as dashboard from './views/dashboard.js';
import * as led from './views/led.js';
import * as wol from './views/wol.js';
import * as devices from './views/devices.js';

const NAV = [
  { path: '/', label: 'Dashboard', icon: 'dashboard' },
  { path: '/led', label: 'LED', icon: 'led' },
  { path: '/wol', label: 'Wake-on-LAN', short: 'WoL', icon: 'wol' },
  { path: '/devices', label: 'Dispositivos', short: 'Disp.', icon: 'devices' }
];

const ROUTES = {
  '/': { title: 'Dashboard', deviceBar: false, mount: dashboard.mount },
  '/led': { title: 'Controle de LED', deviceBar: true, mount: led.mount },
  '/wol': { title: 'Wake-on-LAN', deviceBar: true, mount: wol.mount },
  '/devices': { title: 'Dispositivos', deviceBar: false, mount: devices.mount }
};

/* ------------------------------ navegação ------------------------------ */

function renderNav() {
  $('#nav-links').innerHTML = NAV.map((n) => `
    <a href="${n.path}" data-link data-route="${n.path}" class="navlink">
      ${icon(n.icon)} ${n.label}
    </a>`).join('');

  $('#bottom-nav').innerHTML = NAV.map((n) => `
    <a href="${n.path}" data-link data-route="${n.path}"
       class="flex flex-1 flex-col items-center justify-center gap-1 text-zinc-500 dark:text-zinc-400">
      ${icon(n.icon, 'h-5 w-5')}
      <span class="text-[10px] font-medium">${n.short || n.label}</span>
    </a>`).join('');
}

function setActiveNav(path) {
  $$('[data-route]').forEach((a) => {
    const active = a.dataset.route === path;
    a.classList.toggle('navlink-active', active && a.closest('#nav-links'));
    a.classList.toggle('text-indigo-600', active);
    a.classList.toggle('dark:text-indigo-400', active);
  });
}

/* --------------------------- chrome / topbar --------------------------- */

function setupChrome() {
  // Tema
  const themeBtn = $('#theme-btn');
  themeBtn.innerHTML = themeIcon();
  themeBtn.onclick = () => { toggleTheme(); themeBtn.innerHTML = themeIcon(); };

  // Menu mobile
  const sidebar = $('#sidebar');
  const backdrop = $('#sidebar-backdrop');
  const open = () => { sidebar.classList.remove('-translate-x-full'); backdrop.classList.remove('hidden'); };
  const close = () => { sidebar.classList.add('-translate-x-full'); backdrop.classList.add('hidden'); };
  $('#menu-btn').onclick = open;
  backdrop.onclick = close;
  document.addEventListener('click', (e) => { if (e.target.closest('a[data-link]')) close(); });

  // Indicador de conexão
  const dot = $('#conn-dot');
  const text = $('#conn-text');
  const indicator = $('#conn-indicator');
  function updateConn() {
    const total = store.clients.length;
    const online = store.clients.filter((c) => store.isConnected(c.espMac)).length;
    indicator.classList.toggle('hidden', total === 0);
    indicator.classList.toggle('sm:flex', total > 0);
    dot.className = `h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-zinc-400'}`;
    text.textContent = online ? `${online}/${total} online` : 'Tudo offline';
  }
  store.on('status', updateConn);
  store.on('clients', updateConn);
  updateConn();
}

/* ------------------------------- bootstrap ------------------------------ */

renderNav();
setupChrome();
store.initSSE();
initDeviceBar($('#device-bar'));

const deviceBar = $('#device-bar');
router.start(ROUTES, (path, route) => {
  $('#page-title').textContent = route.title;
  document.title = `${route.title} · EspNest`;
  setActiveNav(path);
  deviceBar.classList.toggle('hidden', !route.deviceBar);
});
