import type { NuevoEvento } from './eventos.service.js';

// Solo en DRY_RUN: produce eventos verosímiles para probar los reportes sin enviar correos reales.
const UAS = [
  { p: 0.34, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 Edge/12.10136' },
  { p: 0.22, ua: 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/12.246 (via ggpht.com GoogleImageProxy)' },
  { p: 0.16, ua: 'Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.17126; Pro)' },
  { p: 0.18, ua: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36' },
  { p: 0.06, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' },
  { p: 0.04, ua: 'Mozilla/5.0' },
];

const azar = () => Math.random();
function ua() {
  let r = azar();
  for (const u of UAS) { if ((r -= u.p) <= 0) return u.ua; }
  return UAS[0].ua;
}

export function simularEventos(base: Omit<NuevoEvento, 'tipo'>, html: string, dominio: string, esB: boolean): NuevoEvento[] {
  const ev: NuevoEvento[] = [];
  const t = (minMin: number, maxMin: number) => new Date(Date.now() + (minMin + azar() * (maxMin - minMin)) * 60_000 - 3 * 3600_000);
  const corporativo = !/gmail|hotmail|outlook|yahoo|live\./.test(dominio);
  const r = azar();
  if (r < 0.011) return [{ ...base, tipo: 'rebote_duro', detalle: '550 5.1.1 The email account that you tried to reach does not exist', fecha: t(0, 1) }];
  if (r < 0.018) return [{ ...base, tipo: 'rebote_suave', detalle: '452 4.2.2 Mailbox full', fecha: t(0, 2) }];
  if (r < 0.020) return [{ ...base, tipo: 'rechazado', detalle: '554 5.7.1 Message rejected by policy', fecha: t(0, 1) }];
  ev.push({ ...base, tipo: 'entregado', fecha: t(0, 1) });
  const pApertura = (corporativo ? 0.36 : 0.28) + (esB ? 0.04 : 0);
  if (azar() < pApertura) {
    const u = ua();
    ev.push({ ...base, tipo: 'apertura', userAgent: u, fecha: t(2, 170) });
    if (azar() < 0.35) ev.push({ ...base, tipo: 'apertura', userAgent: u, fecha: t(30, 178) });
    const enlaces = [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]).filter((x) => !x.includes('/u/'));
    if (enlaces.length && azar() < 0.17) {
      const url = azar() < 0.7 ? enlaces[0] : enlaces[Math.floor(azar() * enlaces.length)];
      ev.push({ ...base, tipo: 'clic', url, userAgent: u, fecha: t(5, 179) });
    }
    if (azar() < 0.008) ev.push({ ...base, tipo: 'baja', detalle: 'Baja por enlace', fecha: t(5, 179) });
  }
  if (azar() < 0.0006) ev.push({ ...base, tipo: 'queja', detalle: 'abuse', fecha: t(10, 179) });
  return ev;
}
