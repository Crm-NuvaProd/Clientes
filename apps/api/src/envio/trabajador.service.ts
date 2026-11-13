import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DbService, type Cliente } from '../comun/db.service.js';
import { config } from '../config.js';
import { htmlDeDiseno } from '../plantillas/plantillas.controller.js';
import { CorreoService, type Remitente } from './correo.service.js';
import { EventosService } from './eventos.service.js';
import { simularEventos } from './simulador.js';

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tope de hoy según el plan de calentamiento de la empresa. */
export function topeDelDia(e: { warmup_inicio: string | Date | null; warmup_plan: number[]; tope_diario: number }, hoy = new Date()) {
  if (!e.warmup_inicio) return { tope: e.tope_diario, dia: null as number | null };
  const inicio = new Date(e.warmup_inicio);
  const dia = Math.max(0, Math.floor((Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()) -
    Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), inicio.getUTCDate())) / 86_400_000));
  const plan = e.warmup_plan?.length ? e.warmup_plan : [e.tope_diario];
  return { tope: Math.min(plan[Math.min(dia, plan.length - 1)], e.tope_diario), dia: dia + 1 };
}

export async function enviadosHoy(c: Cliente): Promise<number> {
  return (await c.query("SELECT count(*) n FROM envios WHERE estado='enviado' AND enviado_en >= date_trunc('day', now())")).rows[0].n;
}

/**
 * Trabajador de envío. Corre en una sola instancia a la vez (candado consultivo de PostgreSQL),
 * así se pueden desplegar varias réplicas de la API sin duplicar correos.
 */
@Injectable()
export class TrabajadorService {
  private log = new Logger('Trabajador');
  private ocupado = false;

  constructor(private db: DbService, private correo: CorreoService, private eventos: EventosService) {}

  @Interval(3000)
  async tick() {
    if (!config.trabajadorActivo || this.ocupado) return;
    this.ocupado = true;
    const conexion = await this.db.pool.connect();
    try {
      const { rows } = await conexion.query('SELECT pg_try_advisory_lock(727001) ok');
      if (!rows[0].ok) return;
      try {
        for (const cmp of await this.db.sistema('SELECT * FROM campanas_pendientes()')) {
          await this.procesar(cmp.empresa_id, cmp.id);
        }
      } finally {
        await conexion.query('SELECT pg_advisory_unlock(727001)');
      }
    } catch (e) {
      this.log.error(`Error en el trabajador: ${(e as Error).message}`);
    } finally {
      conexion.release();
      this.ocupado = false;
    }
  }

  async procesar(empresaId: string, campanaId: string) {
    const camp = await this.db.tx(empresaId, async (c) => (await c.query('SELECT * FROM campanas WHERE id=$1', [campanaId])).rows[0]);
    if (!camp) return;
    if (camp.estado === 'programada') await this.preparar(empresaId, camp);
    else await this.lote(empresaId, campanaId);
  }

  /** Congela el contenido y arma la cola: solo activos, con la política de inactividad, más comprometidos primero. */
  async preparar(empresaId: string, camp: any) {
    await this.db.tx(empresaId, async (c) => {
      const p = (await c.query('SELECT diseno FROM plantillas WHERE id=$1', [camp.plantilla_id])).rows[0];
      const html = p ? await htmlDeDiseno(c, p.diseno, camp.preencabezado) : '';
      const filtros = ["ct.estado='activo'"];
      const params: unknown[] = [empresaId, campanaId(camp)];
      if (camp.lista_ids.length) {
        params.push(camp.lista_ids);
        filtros.push(`ct.id IN (SELECT contacto_id FROM lista_contactos WHERE lista_id = ANY($${params.length}::uuid[]))`);
      }
      if (camp.excluir_inactivos_dias > 0) {
        params.push(camp.excluir_inactivos_dias);
        filtros.push(`NOT (ct.envios >= 3 AND COALESCE(ct.ultima_interaccion, ct.creado) < now() - make_interval(days => $${params.length}))`);
      }
      const ab = camp.ab_porcentaje > 0 && camp.asunto_b;
      await c.query(
        `INSERT INTO envios(empresa_id, campana_id, contacto_id, dominio, orden, variante, estado)
         SELECT $1, $2, ct.id, split_part(ct.email,'@',2),
                row_number() OVER (ORDER BY ct.ultima_interaccion DESC NULLS LAST, ct.aperturas DESC, ct.id),
                'A', 'cola'
         FROM contactos ct WHERE ${filtros.join(' AND ')}
         ON CONFLICT (campana_id, contacto_id) DO NOTHING`, params);
      if (ab) {
        // Muestra aleatoria: mitad A, mitad B; el resto espera al ganador
        const total = (await c.query('SELECT count(*) n FROM envios WHERE campana_id=$1', [camp.id])).rows[0].n;
        const muestra = Math.max(2, Math.round((total * camp.ab_porcentaje) / 100));
        await c.query(`UPDATE envios SET estado='espera_ab' WHERE campana_id=$1`, [camp.id]);
        await c.query(
          `WITH m AS (SELECT id, row_number() OVER (ORDER BY random()) r FROM envios WHERE campana_id=$1)
           UPDATE envios e SET estado='cola', variante = CASE WHEN m.r % 2 = 0 THEN 'B' ELSE 'A' END
           FROM m WHERE e.id=m.id AND m.r <= $2`, [camp.id, muestra]);
      }
      await c.query(`UPDATE campanas SET html=$2, estado=$3, iniciada=now() WHERE id=$1`,
        [camp.id, html, ab ? 'prueba_ab' : 'enviando']);
    });
    this.log.log(`Campaña ${camp.id} preparada`);
  }

  async lote(empresaId: string, campanaId: string) {
    const datos = await this.db.tx(empresaId, async (c) => {
      const camp = (await c.query('SELECT * FROM campanas WHERE id=$1', [campanaId])).rows[0];
      const emp = (await c.query('SELECT * FROM empresas')).rows[0];
      const { tope } = topeDelDia(emp);
      const restante = tope - (await enviadosHoy(c));
      const lote = Math.max(0, Math.min(restante, Math.ceil(Number(emp.ritmo_seg) * 15), 500));
      const filas = lote === 0 ? [] : (await c.query(
        `WITH recientes AS (
           SELECT dominio, count(*) n FROM envios
           WHERE estado='enviado' AND enviado_en > now() - interval '1 minute' GROUP BY dominio)
         SELECT e.id envio_id, e.variante, e.dominio, ct.id, ct.email, ct.nombre, ct.compania, ct.ciudad, ct.cargo, ct.estado
         FROM envios e JOIN contactos ct ON ct.id = e.contacto_id
         LEFT JOIN recientes r ON r.dominio = e.dominio
         WHERE e.campana_id=$1 AND e.estado='cola' AND COALESCE(r.n,0) < $2
         ORDER BY e.orden, e.id LIMIT $3`, [campanaId, emp.tope_dominio_min, lote])).rows;
      return { camp, emp, filas, restante };
    });
    const { camp, emp, filas } = datos;
    if (!['enviando', 'prueba_ab'].includes(camp.estado)) return;

    if (!filas.length) {
      await this.cerrarOAvanzar(empresaId, camp);
      return;
    }
    const remitente: Remitente = { empresaId, fromEmail: emp.from_email, fromNombre: emp.from_nombre, replyTo: emp.reply_to };
    const intervalo = 1000 / Math.max(0.5, Number(emp.ritmo_seg));
    const porDominio = new Map<string, number>();
    let enviados = 0;
    for (const f of filas) {
      // Respeta también el tope por dominio dentro del mismo lote
      const n = porDominio.get(f.dominio) ?? 0;
      if (n >= emp.tope_dominio_min) continue;
      porDominio.set(f.dominio, n + 1);
      const t0 = Date.now();
      const asunto = f.variante === 'B' && camp.asunto_b ? camp.asunto_b : camp.asunto;
      try {
        if (f.estado !== 'activo') {
          await this.db.tx(empresaId, (c) => c.query(`UPDATE envios SET estado='omitido', error=$2 WHERE id=$1`, [f.envio_id, f.estado]));
          continue;
        }
        const mid = await this.correo.enviar(remitente, f, { campanaId: camp.id, asunto, html: camp.html, variante: f.variante });
        await this.db.tx(empresaId, async (c) => {
          await c.query(`UPDATE envios SET estado='enviado', message_id=$2, enviado_en=now(), intentos=intentos+1 WHERE id=$1`, [f.envio_id, mid]);
          await c.query('UPDATE contactos SET envios=envios+1, ultimo_envio=now() WHERE id=$1', [f.id]);
          if (config.simulacion) {
            for (const ev of simularEventos({ empresaId, campanaId: camp.id, contactoId: f.id, variante: f.variante, dominio: f.dominio },
              camp.html, f.dominio, f.variante === 'B')) await this.eventos.registrar(c, ev);
          }
        });
        enviados++;
      } catch (e: any) {
        if (this.correo.esLimiteSes(e)) { await espera(20_000); break; }
        if (this.correo.esCuentaPausada(e)) {
          await this.pausar(empresaId, camp.id, `SES rechazó el envío: ${e.message}. Verifique el dominio y que la cuenta esté fuera del sandbox.`);
          return;
        }
        await this.db.tx(empresaId, (c) => c.query(
          `UPDATE envios SET intentos=intentos+1, error=$2, estado = CASE WHEN intentos+1 >= 3 THEN 'fallido' ELSE 'cola' END WHERE id=$1`,
          [f.envio_id, String(e?.message ?? e).slice(0, 400)]));
      }
      if (enviados % 25 === 0 && (await this.revisarCortacircuitos(empresaId, camp.id))) return;
      const resto = intervalo - (Date.now() - t0);
      if (resto > 0) await espera(resto);
    }
    await this.revisarCortacircuitos(empresaId, camp.id);
    // ¿La pausaron desde el panel mientras enviábamos? el próximo tick lo respeta (solo toma 'enviando')
  }

  private async cerrarOAvanzar(empresaId: string, camp: any) {
    await this.db.tx(empresaId, async (c) => {
      const pend = (await c.query(
        `SELECT count(*) FILTER (WHERE estado='cola') cola, count(*) FILTER (WHERE estado='espera_ab') espera FROM envios WHERE campana_id=$1`,
        [camp.id])).rows[0];
      if (pend.cola > 0) return; // quedan, pero bloqueados por tope diario o por dominio
      if (camp.estado === 'prueba_ab') {
        if (Date.now() - new Date(camp.iniciada).getTime() < camp.ab_horas * 3600_000) return;
        const tipo = camp.ab_criterio === 'clics' ? 'clic' : 'apertura';
        const r = (await c.query(
          `SELECT s.variante, count(DISTINCT ev.contacto_id)::float / NULLIF(count(DISTINCT s.contacto_id),0) tasa
           FROM envios s LEFT JOIN eventos ev ON ev.campana_id=s.campana_id AND ev.contacto_id=s.contacto_id AND ev.tipo=$2 AND NOT ev.es_mpp
           WHERE s.campana_id=$1 AND s.estado='enviado' GROUP BY s.variante`, [camp.id, tipo])).rows;
        const a = r.find((x) => x.variante === 'A')?.tasa ?? 0;
        const b = r.find((x) => x.variante === 'B')?.tasa ?? 0;
        const ganador = b > a ? 'B' : 'A';
        await c.query(`UPDATE envios SET estado='cola', variante=$2 WHERE campana_id=$1 AND estado='espera_ab'`, [camp.id, ganador]);
        await c.query(`UPDATE campanas SET estado='enviando', ab_ganador=$2 WHERE id=$1`, [camp.id, ganador]);
        this.log.log(`Campaña ${camp.id}: gana el asunto ${ganador}`);
        return;
      }
      if (pend.espera === 0) await c.query(`UPDATE campanas SET estado='terminada', terminada=now() WHERE id=$1 AND estado='enviando'`, [camp.id]);
    });
  }

  /** Pausa automática si los rebotes o las quejas superan los umbrales de la empresa. */
  async revisarCortacircuitos(empresaId: string, campanaId: string): Promise<boolean> {
    return this.db.tx(empresaId, async (c) => {
      const r = (await c.query(
        `SELECT (SELECT count(*) FROM envios WHERE campana_id=$1 AND estado='enviado') enviados,
                (SELECT count(DISTINCT contacto_id) FROM eventos WHERE campana_id=$1 AND tipo='rebote_duro') rebotes,
                (SELECT count(DISTINCT contacto_id) FROM eventos WHERE campana_id=$1 AND tipo='queja') quejas,
                e.max_rebote, e.max_queja FROM empresas e`, [campanaId])).rows[0];
      if (r.enviados < 200) return false;
      let motivo = '';
      const f = (v: number, d: number) => (v * 100).toFixed(d).replace('.', ',');
      // Exige un mínimo de casos para no pausar por un solo evento aislado en listas pequeñas
      if (r.rebotes >= 5 && r.rebotes / r.enviados > r.max_rebote) motivo = `Rebote duro de ${f(r.rebotes / r.enviados, 1)} % (límite ${f(r.max_rebote, 1)} %). Limpie la lista antes de reanudar.`;
      else if (r.quejas >= 3 && r.quejas / r.enviados > r.max_queja) motivo = `Quejas de ${f(r.quejas / r.enviados, 2)} % (límite ${f(r.max_queja, 2)} %). Revise a quién envía y el contenido.`;
      if (!motivo) return false;
      await c.query(`UPDATE campanas SET estado='pausada', motivo_pausa=$2 WHERE id=$1 AND estado IN ('enviando','prueba_ab')`, [campanaId, motivo]);
      this.log.warn(`Campaña ${campanaId} pausada: ${motivo}`);
      return true;
    });
  }

  private pausar(empresaId: string, campanaId: string, motivo: string) {
    return this.db.tx(empresaId, (c) => c.query(`UPDATE campanas SET estado='pausada', motivo_pausa=$2 WHERE id=$1`, [campanaId, motivo]));
  }
}

const campanaId = (c: any) => c.id as string;
