function renderHeader(activePage) {
  const desktopItems = [
    { key: 'led', label: 'LED', href: '/' },
    { key: 'wol', label: 'WoL', href: '/wol' },
    { key: 'config', label: 'Config', href: '/config' },
    { key: 'wol-targets', label: 'MACs', href: '/wol-targets' }
  ];

  const mobileItems = [
    { key: 'led', label: 'LED', href: '/' },
    { key: 'wol', label: 'Wake-on-LAN', href: '/wol' },
    { key: 'config', label: 'Configuração', href: '/config' },
    { key: 'wol-targets', label: 'MACs WoL', href: '/wol-targets' },
    { key: 'logout', label: 'Sair', href: '/logout' }
  ];

  const desktopNav = desktopItems.map((item) => {
    if (item.key === activePage) {
      return `<a href="${item.href}" class="rounded-lg bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950">${item.label}</a>`;
    }

    return `<a href="${item.href}" class="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800/70 hover:text-white">${item.label}</a>`;
  }).join('');

  const mobileNav = mobileItems.map((item) => {
    if (item.key === activePage) {
      return `<a href="${item.href}" class="rounded-lg bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-950">${item.label}</a>`;
    }

    return `<a href="${item.href}" class="rounded-lg bg-slate-800/60 px-3 py-2 text-sm text-slate-200">${item.label}</a>`;
  }).join('');

  return `
  <header class="w-full border-b border-slate-700/70 bg-slate-950/85 backdrop-blur-xl">
    <div class="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4">
      <a href="/" class="flex items-center gap-2 text-white">
        <span class="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white text-black text-sm font-black">⚡</span>
        <span class="text-sm font-semibold tracking-wide">ESP32 HUB</span>
      </a>

      <nav class="hidden items-center gap-2 md:flex">
        ${desktopNav}
      </nav>

      <div class="hidden items-center gap-2 md:flex">
        <a href="/logout" class="rounded-lg border border-red-500/50 px-3 py-2 text-sm text-red-200 hover:bg-red-800/70">Sair</a>
      </div>

      <button id="mobileMenuBtn" type="button" aria-expanded="false" aria-label="Abrir menu" class="rounded-lg border border-slate-500/50 p-2 text-red-200 md:hidden">
        <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>
    </div>

    <nav id="topNav" class="hidden border-t border-slate-700/70 md:hidden">
      <div class="mx-auto grid w-full max-w-6xl gap-2 px-4 py-3">
        ${mobileNav}
      </div>
    </nav>
  </header>`;
}

function renderDeviceSelector(marginClass = 'mb-4') {
  return `<div id="deviceList" class="${marginClass} grid grid-cols-2 gap-2 min-[680px]:grid-cols-3"></div>`;
}

function renderDeviceSelectorHelpers() {
  return `
    function renderDeviceSelectorCards(container, clients, selectedEspMacs, connectedClients) {
      if (!clients.length) {
        container.innerHTML = '<div class="col-span-full rounded-lg bg-white/10 p-2.5 text-[13px]">Nenhum cliente cadastrado.</div>';
        return;
      }

      container.innerHTML = clients.map((client) => {
        const selected = selectedEspMacs.has(client.espMac);
        const online = connectedClients.has(client.espMac);
        const stateClasses = selected
          ? 'border-green-500 bg-green-500/20'
          : 'border-white/20 bg-white/5 hover:bg-white/10';

        return \`
          <button type="button" class="device-card w-full rounded-lg border px-[9px] py-2 text-left text-white \${stateClasses}" data-esp-mac="\${client.espMac}" title="\${online ? 'Online' : 'Offline'}">
            <div class="flex items-center justify-between gap-2">
              <div class="text-[13px] font-semibold leading-tight">\${escapeHtml(client.nickname)}</div>
              <div class="inline-flex items-center gap-1.5">
                <span class="h-2 w-2 shrink-0 rounded-full \${online ? 'bg-green-400' : 'bg-red-400'}"></span>
                <span class="hidden text-[11px] text-slate-300 lg:inline">\${online ? 'Online' : 'Offline'}</span>
              </div>
            </div>
          </button>
        \`;
      }).join('');
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  `;
}

function renderStatusHelpers() {
  return `
    function getStatusClasses(baseClass) {
      return {
        info: baseClass + ' border border-blue-400/30 bg-blue-500/15 text-blue-300',
        success: baseClass + ' border border-green-400/30 bg-green-500/15 text-green-300',
        error: baseClass + ' border border-red-400/30 bg-red-500/15 text-red-300'
      };
    }

    function setStatusUI(statusElement, statusClasses, type, message, animatedDot = false) {
      const nextType = statusClasses[type] ? type : 'info';
      const dotClass = animatedDot
        ? 'h-2 w-2 animate-pulse rounded-full bg-current'
        : 'h-2 w-2 rounded-full bg-current';

      statusElement.className = statusClasses[nextType];
      statusElement.innerHTML = '<div class="' + dotClass + '"></div><span>' + message + '</span>';
    }
  `;
}

module.exports = {
  renderHeader,
  renderDeviceSelector,
  renderDeviceSelectorHelpers,
  renderStatusHelpers
};
