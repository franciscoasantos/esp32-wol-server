// Traduz a resposta de lote { okCount, failCount, results } em um toast claro
// com detalhe por dispositivo.

import { toast } from '../ui.js';

export function showResult(summary, { actionLabel = 'Comando', clientsByMac = {} } = {}) {
  const ok = summary.okCount || 0;
  const fail = summary.failCount || 0;
  const total = ok + fail;
  const name = (mac) => (clientsByMac[mac] && clientsByMac[mac].nickname) || mac;

  if (fail === 0 && ok > 0) {
    toast('success', `${actionLabel}: ${ok} ${ok === 1 ? 'dispositivo' : 'dispositivos'}`);
    return;
  }

  const failed = (summary.results || [])
    .filter((r) => !r.ok)
    .map((r) => `${name(r.espMac)} (${r.error || 'falha'})`)
    .join(' · ');

  if (ok === 0) {
    toast('error', `${actionLabel} falhou`, { detail: failed });
  } else {
    toast('info', `${actionLabel}: ${ok}/${total} ok`, { detail: `Falhou: ${failed}` });
  }
}
