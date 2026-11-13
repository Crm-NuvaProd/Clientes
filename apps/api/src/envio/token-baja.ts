import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

// Token sin expiración (la ley exige que la baja funcione siempre): empresa.contacto.campaña + HMAC
const firma = (s: string) => createHmac('sha256', config.bajaSecreto).update(s).digest('base64url').slice(0, 22);

export function crearTokenBaja(empresaId: string, contactoId: number, campanaId: string | null): string {
  const datos = Buffer.from(`${empresaId}.${contactoId}.${campanaId ?? ''}`).toString('base64url');
  return `${datos}.${firma(datos)}`;
}

export function leerTokenBaja(token: string): { empresaId: string; contactoId: number; campanaId: string | null } | null {
  const [datos, f] = (token ?? '').split('.');
  if (!datos || !f) return null;
  const esperado = Buffer.from(firma(datos));
  const recibido = Buffer.from(f);
  if (esperado.length !== recibido.length || !timingSafeEqual(esperado, recibido)) return null;
  const [empresaId, cid, campanaId] = Buffer.from(datos, 'base64url').toString().split('.');
  if (!/^[0-9a-f-]{36}$/.test(empresaId) || !/^\d+$/.test(cid)) return null;
  return { empresaId, contactoId: Number(cid), campanaId: campanaId || null };
}

export const urlBaja = (empresaId: string, contactoId: number, campanaId: string | null) =>
  `${config.urlPublica}/u/${crearTokenBaja(empresaId, contactoId, campanaId)}`;
