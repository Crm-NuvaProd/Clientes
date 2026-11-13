import { Controller, Get, Header, NotFoundException, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import type { Kpis, Panel, ReporteCampana } from '@nuvamail/contratos';
import type { Response } from 'express';
import { DbService, type Cliente } from '../comun/db.service.js';
import { Usuario, type Sesion } from '../comun/seguridad.js';
import { enviadosHoy, topeDelDia } from '../envio/trabajador.service.js';
import { calcularVeredicto } from './veredicto.js';

const div = (a: number, b: number) => (b > 0 ? a / b : 0);

export async function kpis(c: Cliente, campanaId: string): Promise<Kpis> {
  const s = (await c.query(
    `SELECT count(*) destinatarios,
       count(*) FILTER (WHERE estado='enviado') enviados,
       count(*) FILTER (WHERE estado IN ('cola','espera_ab')) en_cola,
       count(*) FILTER (WHERE estado='omitido') omitidos,
       count(*) FILTER (WHERE estado='fallido') fallidos
     FROM envios WHERE campana_id=$1`, [campanaId])).rows[0];
  const e = (await c.query(
    `SELECT
       count(DISTINCT contacto_id) FILTER (WHERE tipo='entregado') entregados,
       count(DISTINCT contacto_id) FILTER (WHERE tipo='rebote_duro') rebotes_duros,
       count(DISTINCT contacto_id) FILTER (WHERE tipo='rebote_suave') rebotes_suaves,
       count(DISTINCT contacto_id) FILTER (WHERE tipo='rechazado') rechazados,
       count(DISTINCT contacto_id) FILTER (WHERE tipo='queja') quejas,
       count(DISTINCT contacto_id) FILTER (WHERE tipo='baja') bajas,
       count(DISTINCT contacto_id) FILTER (WHERE tipo='apertura') aperturas_unicas,
       count(*) FILTER (WHERE tipo='apertura') aperturas_totales,
       count(DISTINCT contacto_id) FILTER (WHERE tipo='apertura' AND es_mpp) aperturas_mpp,
       count(DISTINCT contacto_id) FILTER (WHERE tipo='apertura' AND NOT es_mpp) aperturas_reales,
       count(DISTINCT contacto_id) FILTER (WHERE tipo='clic') clics_unicos,
       count(*) FILTER (WHERE tipo='clic') clics_totales
     FROM eventos WHERE campana_id=$1`, [campanaId])).rows[0];
  const entregados = e.entregados;
  return {
    destinatarios: s.destinatarios, enviados: s.enviados, enCola: s.en_cola, omitidos: s.omitidos, fallidos: s.fallidos,
    entregados, rebotesDuros: e.rebotes_duros, rebotesSuaves: e.rebotes_suaves, rechazados: e.rechazados, quejas: e.quejas,
    bajas: e.bajas, aperturasUnicas: e.aperturas_unicas, aperturasTotales: e.aperturas_totales, aperturasMpp: e.aperturas_mpp,
    clicsUnicos: e.clics_unicos, clicsTotales: e.clics_totales,
    tasaEntrega: div(entregados, s.enviados),
    tasaRebote: div(e.rebotes_duros, s.enviados),
    tasaApertura: div(e.aperturas_unicas, entregados),
    tasaAperturaSinMpp: div(e.aperturas_reales, entregados),
    tasaClic: div(e.clics_unicos, entregados),
    ctor: div(e.clics_unicos, e.aperturas_unicas),
    tasaBaja: div(e.bajas, entregados),
    tasaQueja: div(e.quejas, entregados),
  };
}

@Controller('estadisticas')
export class EstadisticasController {
  constructor(private db: DbService) {}

  @Get('campanas/:id')
  async reporte(@Usuario() s: Sesion, @Param('id', ParseUUIDPipe) id: string): Promise<ReporteCampana> {
    return this.db.tx(s.empresaId, async (c) => {
      const campana = (await c.query('SELECT * FROM campanas WHERE id=$1', [id])).rows[0];
      if (!campana) throw new NotFoundException();
      delete campana.html;
      const k = await kpis(c, id);

      // Promedio de las últimas 5 campañas terminadas (para comparar)
      const previas = (await c.query(
        `SELECT id FROM campanas WHERE estado='terminada' AND id<>$1 ORDER BY terminada DESC LIMIT 5`, [id])).rows;
      let sumA = 0, sumC = 0;
      for (const p of previas) { const kp = await kpis(c, p.id); sumA += kp.tasaAperturaSinMpp; sumC += kp.tasaClic; }
      const comparacion = { promedioApertura: div(sumA, previas.length), promedioClic: div(sumC, previas.length), campanasComparadas: previas.length };

      const q = async (sql: string) => (await c.query(sql, [id])).rows;
      const lineaTiempo = await q(
        `SELECT to_char(date_trunc('hour', creado) AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:00') hora,
           count(DISTINCT contacto_id) FILTER (WHERE tipo='apertura' AND NOT es_mpp) aperturas,
           count(DISTINCT contacto_id) FILTER (WHERE tipo='clic') clics
         FROM eventos WHERE campana_id=$1 AND tipo IN ('apertura','clic') GROUP BY 1 ORDER BY 1 LIMIT 336`);
      const porDominio = await q(
        `WITH d AS (SELECT CASE WHEN dominio IN ('gmail.com','hotmail.com','outlook.com','live.com','yahoo.com','icloud.com','yahoo.es','hotmail.es','outlook.es')
                       THEN dominio ELSE 'corporativos' END grupo, contacto_id FROM envios WHERE campana_id=$1 AND estado='enviado')
         SELECT d.grupo dominio, count(*) enviados,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM eventos v WHERE v.campana_id=$1 AND v.contacto_id=d.contacto_id AND v.tipo='entregado')) entregados,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM eventos v WHERE v.campana_id=$1 AND v.contacto_id=d.contacto_id AND v.tipo IN ('rebote_duro','rebote_suave','rechazado'))) rebotes,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM eventos v WHERE v.campana_id=$1 AND v.contacto_id=d.contacto_id AND v.tipo='apertura' AND NOT v.es_mpp)) aperturas,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM eventos v WHERE v.campana_id=$1 AND v.contacto_id=d.contacto_id AND v.tipo='clic')) clics
         FROM d GROUP BY 1 ORDER BY 2 DESC`);
      const porDispositivo = await q(
        `SELECT dispositivo, count(DISTINCT contacto_id) aperturas FROM eventos
         WHERE campana_id=$1 AND tipo='apertura' GROUP BY 1 ORDER BY 2 DESC`);
      const porCliente = await q(
        `SELECT cliente, count(DISTINCT contacto_id) aperturas FROM eventos
         WHERE campana_id=$1 AND tipo='apertura' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`);
      const enlaces = await q(
        `SELECT url, count(DISTINCT contacto_id) "clicsUnicos", count(*) "clicsTotales" FROM eventos
         WHERE campana_id=$1 AND tipo='clic' GROUP BY 1 ORDER BY 2 DESC LIMIT 30`);
      const motivosRebote = await q(
        `SELECT left(detalle, 140) motivo, CASE WHEN tipo='rebote_suave' THEN 'suave' ELSE 'duro' END tipo, count(*) cantidad
         FROM eventos WHERE campana_id=$1 AND tipo IN ('rebote_duro','rebote_suave','rechazado') GROUP BY 1,2 ORDER BY 3 DESC LIMIT 15`);
      let ab: ReporteCampana['ab'] = null;
      if (campana.ab_porcentaje > 0) {
        const filas = await q(
          `SELECT s.variante,
             count(DISTINCT s.contacto_id) FILTER (WHERE s.estado='enviado') enviados,
             count(DISTINCT v.contacto_id) FILTER (WHERE v.tipo='apertura' AND NOT v.es_mpp) aperturas,
             count(DISTINCT v.contacto_id) FILTER (WHERE v.tipo='clic') clics
           FROM envios s LEFT JOIN eventos v ON v.campana_id=s.campana_id AND v.contacto_id=s.contacto_id
           WHERE s.campana_id=$1 GROUP BY s.variante ORDER BY 1`);
        ab = filas.map((f) => ({ ...f, asunto: f.variante === 'B' ? campana.asunto_b : campana.asunto }));
      }
      return {
        campana, kpis: k, veredicto: calcularVeredicto(k, comparacion.campanasComparadas ? comparacion.promedioApertura : undefined),
        comparacion, lineaTiempo, porDominio, porDispositivo, porCliente, enlaces, motivosRebote, ab,
      };
    });
  }

  /** Exporta el detalle por destinatario (como el reporte CSV de Brevo). */
  @Get('campanas/:id/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async csv(@Usuario() s: Sesion, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const filas = await this.db.tx(s.empresaId, async (c) => (await c.query(
      `SELECT ct.email, ct.nombre, ct.compania, s.variante, s.estado, s.enviado_en,
         bool_or(v.tipo='entregado') entregado, bool_or(v.tipo='apertura' AND NOT v.es_mpp) abrio,
         bool_or(v.tipo='clic') clic, bool_or(v.tipo IN ('rebote_duro','rebote_suave')) rebote,
         bool_or(v.tipo='baja') baja, bool_or(v.tipo='queja') queja
       FROM envios s JOIN contactos ct ON ct.id=s.contacto_id
       LEFT JOIN eventos v ON v.campana_id=s.campana_id AND v.contacto_id=s.contacto_id
       WHERE s.campana_id=$1 GROUP BY ct.id, s.id ORDER BY ct.email`, [id])).rows);
    const celda = (v: unknown) => {
      let t = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v === true ? 'si' : v === false ? 'no' : v);
      if (/^[=+\-@]/.test(t)) t = `'${t}`; // evita inyección de fórmulas en Excel
      return `"${t.replace(/"/g, '""')}"`;
    };
    const cab = ['email', 'nombre', 'empresa', 'variante', 'estado', 'enviado_en', 'entregado', 'abrio', 'clic', 'rebote', 'baja', 'queja'];
    res.setHeader('Content-Disposition', `attachment; filename="campana-${id.slice(0, 8)}.csv"`);
    res.send('﻿' + [cab.join(';'), ...filas.map((f) => [f.email, f.nombre, f.compania, f.variante, f.estado, f.enviado_en,
      f.entregado, f.abrio, f.clic, f.rebote, f.baja, f.queja].map(celda).join(';'))].join('\r\n'));
  }

  @Get('panel')
  async panel(@Usuario() s: Sesion): Promise<Panel> {
    return this.db.tx(s.empresaId, async (c) => {
      const est = Object.fromEntries((await c.query('SELECT estado, count(*) n FROM contactos GROUP BY 1')).rows.map((r) => [r.estado, r.n]));
      const contactos = { activo: 0, baja: 0, rebote: 0, queja: 0, invalido: 0, ...est };
      const emp = (await c.query('SELECT * FROM empresas')).rows[0];
      const { tope, dia } = topeDelDia(emp);
      const u = (await c.query(
        `SELECT (SELECT count(*) FROM envios WHERE estado='enviado' AND enviado_en > now() - interval '30 days') enviados,
           count(DISTINCT (campana_id, contacto_id)) FILTER (WHERE tipo='entregado') entregados,
           count(DISTINCT (campana_id, contacto_id)) FILTER (WHERE tipo='apertura' AND NOT es_mpp) aperturas,
           count(DISTINCT (campana_id, contacto_id)) FILTER (WHERE tipo='clic') clics,
           count(DISTINCT (campana_id, contacto_id)) FILTER (WHERE tipo='queja') quejas,
           count(DISTINCT (campana_id, contacto_id)) FILTER (WHERE tipo='rebote_duro') rebotes
         FROM eventos WHERE creado > now() - interval '30 days'`)).rows[0];
      const ultimos30 = {
        enviados: u.enviados, tasaEntrega: div(u.entregados, u.enviados), tasaApertura: div(u.aperturas, u.entregados),
        tasaClic: div(u.clics, u.entregados), tasaQueja: div(u.quejas, u.entregados), tasaRebote: div(u.rebotes, u.enviados),
      };
      const tendencia = [];
      for (const p of (await c.query(
        `SELECT id, nombre, COALESCE(terminada, iniciada) fecha FROM campanas WHERE iniciada IS NOT NULL ORDER BY iniciada DESC LIMIT 10`)).rows.reverse()) {
        const k = await kpis(c, p.id);
        tendencia.push({ campana: p.nombre, fecha: p.fecha, apertura: k.tasaAperturaSinMpp, clic: k.tasaClic, rebote: k.tasaRebote });
      }
      const mensajes: string[] = [];
      let nivel: 'bien' | 'regular' | 'mal' = 'bien';
      if (ultimos30.tasaQueja > 0.001) { nivel = 'mal'; mensajes.push('Quejas por encima de 0,1 % en 30 días: riesgo de que Gmail envíe todo a spam.'); }
      if (ultimos30.tasaRebote > 0.02) { nivel = 'mal'; mensajes.push('Rebote duro por encima de 2 % en 30 días: depure la base.'); }
      else if (ultimos30.tasaRebote > 0.005) { if (nivel === 'bien') nivel = 'regular'; mensajes.push('Rebote duro entre 0,5 % y 2 %: vigile la calidad de las listas que importa.'); }
      const total = Object.values(contactos).reduce((a: number, b: any) => a + Number(b), 0);
      if (total && contactos.activo / total < 0.8) { if (nivel === 'bien') nivel = 'regular'; mensajes.push('Menos del 80 % de la base está activa: revise de dónde vienen las bajas y rebotes.'); }
      if (!emp.from_email) { nivel = nivel === 'mal' ? 'mal' : 'regular'; mensajes.push('Falta configurar el remitente.'); }
      if (!mensajes.length) mensajes.push('Reputación sana en los últimos 30 días.');
      return { contactos, enviadosHoy: await enviadosHoy(c), topeHoy: tope, diaCalentamiento: dia, ultimos30, tendencia, salud: { nivel, mensajes } };
    });
  }
}
