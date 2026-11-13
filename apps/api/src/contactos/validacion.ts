import { promises as dns } from 'node:dns';

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const DESECHABLES = new Set(['mailinator.com', '10minutemail.com', 'guerrillamail.com', 'tempmail.com', 'yopmail.com',
  'trashmail.com', 'sharklasers.com', 'getnada.com', 'temp-mail.org', 'dispostable.com', 'maildrop.cc']);
const TYPOS: Record<string, string> = {
  'gmail.co': 'gmail.com', 'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmail.con': 'gmail.com', 'gamil.com': 'gmail.com',
  'hotmail.co': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotmal.com': 'hotmail.com',
  'outlook.co': 'outlook.com', 'outlok.com': 'outlook.com', 'yahoo.co': 'yahoo.com', 'yahoo.con': 'yahoo.com',
};
const ROL = new Set(['info', 'ventas', 'contacto', 'admin', 'soporte', 'facturacion', 'contabilidad', 'gerencia',
  'compras', 'rrhh', 'webmaster', 'comercial', 'servicioalcliente']);
const BLOQUEADOS = new Set(['noreply', 'no-reply', 'postmaster', 'abuse', 'mailer-daemon', 'donotreply']);

export const normalizar = (e: string) => (e ?? '').trim().replace(/^<|>$/g, '').trim().toLowerCase();

const cacheMx = new Map<string, Promise<boolean | null>>();
export function dominioRecibe(dominio: string): Promise<boolean | null> {
  let p = cacheMx.get(dominio);
  if (!p) {
    p = (async () => {
      try {
        const mx = await dns.resolveMx(dominio);
        if (mx.length && mx.every((m) => m.exchange === '' || m.exchange === '.')) return false; // MX nulo
        return mx.length > 0;
      } catch (e: any) {
        if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') {
          try { await dns.resolve4(dominio); return true; } catch { return false; }
        }
        return null; // no se pudo verificar: no se descarta
      }
    })();
    cacheMx.set(dominio, p);
  }
  return p;
}

export async function revisarCorreo(email: string, mx: boolean): Promise<{ estado: 'ok' | 'generico' | 'invalido'; motivo: string }> {
  if (!EMAIL_RE.test(email) || email.length > 254) return { estado: 'invalido', motivo: 'sintaxis inválida' };
  const [local, dominio] = email.split('@');
  if (TYPOS[dominio]) return { estado: 'invalido', motivo: `posible error de digitación (¿${local}@${TYPOS[dominio]}?)` };
  if (DESECHABLES.has(dominio)) return { estado: 'invalido', motivo: 'dominio desechable' };
  if (BLOQUEADOS.has(local)) return { estado: 'invalido', motivo: 'buzón que no debe recibir marketing' };
  if (mx && (await dominioRecibe(dominio)) === false) return { estado: 'invalido', motivo: 'el dominio no recibe correo (sin MX)' };
  if (ROL.has(local)) return { estado: 'generico', motivo: 'buzón genérico' };
  return { estado: 'ok', motivo: '' };
}

const ALIAS: Record<string, string[]> = {
  email: ['email', 'correo', 'e-mail', 'correo electronico', 'correo electrónico', 'mail'],
  nombre: ['nombre', 'name', 'contacto', 'nombres', 'nombre completo'],
  compania: ['empresa', 'company', 'razon social', 'razón social', 'cliente', 'compania', 'compañía'],
  ciudad: ['ciudad', 'city'],
  cargo: ['cargo', 'puesto', 'title'],
  origen: ['origen_consentimiento', 'origen', 'fuente'],
  fecha: ['fecha_consentimiento', 'fecha'],
};

export function mapearColumnas(encabezados: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const h of encabezados) {
    const k = h.trim().toLowerCase();
    for (const [campo, alias] of Object.entries(ALIAS)) {
      if (alias.includes(k) && !Object.values(m).includes(campo)) m[h] = campo;
    }
  }
  return m;
}

export function decodificar(buf: Buffer): string {
  const utf = new TextDecoder('utf-8', { fatal: true });
  try { return utf.decode(buf).replace(/^﻿/, ''); } catch { return new TextDecoder('windows-1252').decode(buf); }
}
