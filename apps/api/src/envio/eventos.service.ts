import { Injectable } from '@nestjs/common';
import { UAParser } from 'ua-parser-js';
import type { Cliente } from '../comun/db.service.js';

export type TipoEvento = 'entregado' | 'rebote_duro' | 'rebote_suave' | 'queja' | 'apertura' | 'clic' | 'baja' | 'rechazado' | 'retraso';

export interface NuevoEvento {
  empresaId: string; campanaId: string | null; contactoId: number | null; variante?: string | null;
  tipo: TipoEvento; detalle?: string; url?: string; userAgent?: string; dominio?: string; fecha?: Date;
}

/** Apple Mail Privacy Protection precarga las imágenes desde un proxy con un User-Agent genérico. */
export function esMpp(ua = ''): boolean {
  return ua.trim() === 'Mozilla/5.0' || /AppleWebKit\/605\.1\.15 \(KHTML, like Gecko\)$/.test(ua.trim());
}

export function dispositivo(ua = ''): { dispositivo: string; cliente: string } {
  if (!ua) return { dispositivo: 'desconocido', cliente: 'desconocido' };
  if (esMpp(ua)) return { dispositivo: 'desconocido', cliente: 'Apple Mail (MPP)' };
  const r = new UAParser(ua).getResult();
  const tipo = r.device.type === 'mobile' ? 'móvil' : r.device.type === 'tablet' ? 'tableta' : 'escritorio';
  let cliente = r.browser.name ?? 'Otro';
  if (/GoogleImageProxy/i.test(ua)) cliente = 'Gmail';
  else if (/Outlook|Microsoft Office|ms-office/i.test(ua)) cliente = 'Outlook';
  else if (/YahooMailProxy/i.test(ua)) cliente = 'Yahoo Mail';
  else if (/Thunderbird/i.test(ua)) cliente = 'Thunderbird';
  return { dispositivo: /GoogleImageProxy/i.test(ua) ? 'desconocido' : tipo, cliente };
}

@Injectable()
export class EventosService {
  /** Registra el evento y aplica sus efectos sobre el contacto (supresión automática). Requiere tx de la empresa. */
  async registrar(c: Cliente, e: NuevoEvento) {
    const ua = e.userAgent ?? '';
    const mpp = e.tipo === 'apertura' && esMpp(ua);
    const d = e.tipo === 'apertura' || e.tipo === 'clic' ? dispositivo(ua) : { dispositivo: '', cliente: '' };
    await c.query(
      `INSERT INTO eventos(empresa_id,campana_id,contacto_id,variante,tipo,detalle,url,dominio,dispositivo,cliente,es_mpp,creado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12, now()))`,
      [e.empresaId, e.campanaId, e.contactoId, e.variante ?? null, e.tipo, (e.detalle ?? '').slice(0, 500),
       (e.url ?? '').slice(0, 1000), e.dominio ?? '', d.dispositivo, d.cliente, mpp, e.fecha ?? null]);
    if (!e.contactoId) return;
    const id = e.contactoId;
    switch (e.tipo) {
      case 'rebote_duro':
        await c.query(`UPDATE contactos SET estado='rebote', estado_motivo=$2, actualizado=now() WHERE id=$1 AND estado IN ('activo')`,
          [id, `Rebote permanente: ${(e.detalle ?? '').slice(0, 200)}`]);
        break;
      case 'rebote_suave':
        await c.query(`UPDATE contactos SET rebotes_suaves_seguidos = rebotes_suaves_seguidos + 1,
          estado = CASE WHEN rebotes_suaves_seguidos + 1 >= 3 AND estado='activo' THEN 'rebote' ELSE estado END,
          estado_motivo = CASE WHEN rebotes_suaves_seguidos + 1 >= 3 AND estado='activo' THEN '3 rebotes temporales seguidos' ELSE estado_motivo END
          WHERE id=$1`, [id]);
        break;
      case 'entregado':
        await c.query('UPDATE contactos SET rebotes_suaves_seguidos=0 WHERE id=$1 AND rebotes_suaves_seguidos>0', [id]);
        break;
      case 'queja':
        await c.query(`UPDATE contactos SET estado='queja', estado_motivo='Marcó el correo como spam', actualizado=now() WHERE id=$1`, [id]);
        break;
      case 'baja':
        await c.query(`UPDATE contactos SET estado='baja', estado_motivo=$2, actualizado=now() WHERE id=$1 AND estado='activo'`,
          [id, e.detalle || 'Baja por enlace']);
        break;
      case 'apertura':
        // Las aperturas automáticas de Apple no cuentan como interacción real
        if (!mpp) await c.query('UPDATE contactos SET aperturas=aperturas+1, ultima_interaccion=now() WHERE id=$1', [id]);
        break;
      case 'clic':
        await c.query('UPDATE contactos SET clics=clics+1, ultima_interaccion=now() WHERE id=$1', [id]);
        break;
    }
  }
}
