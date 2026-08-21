// ponytail: service worker mínimo, existe só para tornar o app instalável.
// NÃO cacheia nada de propósito — sem rede não há ESP32 para controlar, então um shell
// offline só mostraria uma UI morta. Se um dia o objetivo for abrir offline, é aqui que
// entra o cache (e o Tailwind precisa sair da CDN antes).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Handler vazio: o Chrome exige um listener de fetch para considerar o app instalável.
// Sem respondWith, toda requisição segue direto para a rede.
self.addEventListener('fetch', () => {});
