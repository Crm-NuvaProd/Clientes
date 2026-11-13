import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put,
} from '@nestjs/common';
import type { Campana, RevisionItem } from '@nuvamail/contratos';
import { ArrayMaxSize, IsArray, IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { DbService, type Cliente } from '../comun/db.service.js';
import { Roles, Usuario, type Sesion } from '../comun/seguridad.js';
import { CorreoService } from '../envio/correo.service.js';
import { topeDelDia } from '../envio/trabajador.service.js';
import { htmlDeDiseno } from '../plantillas/plantillas.controller.js';
import { revisar } from './revision.js';

class CampanaDto {
  @IsString() @MaxLength(150) nombre: string;
  @IsOptional() @IsString() @MaxLength(150) asunto?: string;
  @IsOptional() @IsString() @MaxLength(150) asunto_b?: string;
  @IsOptional() @IsInt() @Min(0) @Max(50) ab_porcentaje?: number;
  @IsOptional() @IsInt() @Min(1) @Max(72) ab_horas?: number;
  @IsOptional() @IsIn(['aperturas', 'clics']) ab_criterio?: 'aperturas' | 'clics';
  @IsOptional() @IsString() @MaxLength(200) preencabezado?: string;
  @IsOptional() @IsUUID() plantilla_id?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) lista_ids?: string[];
  @IsOptional() @IsInt() @Min(0) @Max(730) excluir_inactivos_dias?: number;
}
class PruebaDto {
  @IsArray() @ArrayMaxSize(5) @IsEmail({}, { each: true }) correos: string[];
}
class EnviarDto {
  @IsIn(['ENVIAR']) confirmacion: string;
  @IsOptional() @IsDateString() programada_para?: string;
}

const CAMPOS = ['nombre', 'asunto', 'asunto_b', 'ab_porcentaje', 'ab_horas', 'ab_criterio', 'preencabezado', 'plantilla_id',
  'lista_ids', 'excluir_inactivos_dias'] as const;

@Controller('campanas')
export class CampanasController {
  constructor(private db: DbService, private correo: CorreoService) {}

  @Get()
  async listar(@Usuario() s: Sesion) {
    return this.db.tx(s.empresaId, async (c) => (await c.query(
      `SELECT ca.id, ca.nombre, ca.asunto, ca.estado, ca.creado, ca.iniciada, ca.terminada, ca.programada_para,
         count(e.id) FILTER (WHERE e.estado='enviado') enviados,
         count(e.id) FILTER (WHERE e.estado IN ('cola','espera_ab')) en_cola,
         (SELECT count(DISTINCT contacto_id) FROM eventos v WHERE v.campana_id=ca.id AND v.tipo='apertura' AND NOT v.es_mpp) aperturas,
         (SELECT count(DISTINCT contacto_id) FROM eventos v WHERE v.campana_id=ca.id AND v.tipo='clic') clics
       FROM campanas ca LEFT JOIN envios e ON e.campana_id=ca.id GROUP BY ca.id ORDER BY ca.creado DESC LIMIT 200`)).rows);
  }

  @Get(':id')
  async obtener(@Usuario() s: Sesion, @Param('id', ParseUUIDPipe) id: string): Promise<Campana> {
    const c = await this.db.tx(s.empresaId, async (c) => (await c.query('SELECT * FROM campanas WHERE id=$1', [id])).rows[0]);
    if (!c) throw new NotFoundException();
    delete c.html;
    return c;
  }

  @Roles('admin', 'editor')
  @Post()
  async crear(@Usuario() s: Sesion, @Body() dto: CampanaDto) {
    return this.db.tx(s.empresaId, async (c) => (await c.query(
      `INSERT INTO campanas(empresa_id, ${CAMPOS.join(',')}) VALUES ($1, ${CAMPOS.map((_, i) => `$${i + 2}`).join(',')}) RETURNING id`,
      [s.empresaId, ...this.valores(dto)])).rows[0]);
  }

  @Roles('admin', 'editor')
  @Put(':id')
  async guardar(@Usuario() s: Sesion, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CampanaDto) {
    return this.db.tx(s.empresaId, async (c) => {
      const r = await c.query(
        `UPDATE campanas SET ${CAMPOS.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1 AND estado='borrador' RETURNING id`,
        [id, ...this.valores(dto)]);
      if (!r.rowCount) throw new BadRequestException('Solo se pueden editar campañas en borrador');
      return r.rows[0];
    });
  }

  private valores(d: CampanaDto) {
    return [d.nombre, d.asunto ?? '', d.asunto_b ?? '', d.ab_porcentaje ?? 0, d.ab_horas ?? 4, d.ab_criterio ?? 'aperturas',
      d.preencabezado ?? '', d.plantilla_id ?? null, d.lista_ids ?? [], d.excluir_inactivos_dias ?? 0];
  }

  @Roles('admin', 'editor')
  @Delete(':id')
  @HttpCode(204)
  async borrar(@Usuario() s: Sesion, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.tx(s.empresaId, (c) => c.query(`DELETE FROM campanas WHERE id=$1 AND estado='borrador'`, [id]));
  }

  @Roles('admin', 'editor')
  @Post(':id/duplicar')
  async duplicar(@Usuario() s: Sesion, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(s.empresaId, async (c) => (await c.query(
      `INSERT INTO campanas(empresa_id, ${CAMPOS.join(',')})
       SELECT empresa_id, nombre||' (copia)', ${CAMPOS.slice(1).join(',')} FROM campanas WHERE id=$1 RETURNING id`, [id])).rows[0]);
  }

  /** Cuenta destinatarios con las mismas reglas que usa el trabajador al armar la cola. */
  private async destinatarios(c: Cliente, camp: any): Promise<{ total: number; excluidosInactivos: number }> {
    const p: unknown[] = [];
    let base = "estado='activo'";
    if (camp.lista_ids?.length) { p.push(camp.lista_ids); base += ` AND id IN (SELECT contacto_id FROM lista_contactos WHERE lista_id = ANY($1::uuid[]))`; }
    const inactivo = camp.excluir_inactivos_dias > 0
      ? `envios >= 3 AND COALESCE(ultima_interaccion, creado) < now() - make_interval(days => ${Number(camp.excluir_inactivos_dias)})`
      : 'FALSE';
    const r = (await c.query(`SELECT count(*) FILTER (WHERE NOT (${inactivo})) total, count(*) FILTER (WHERE ${inactivo}) excl
      FROM contactos WHERE ${base}`, p)).rows[0];
    return { total: r.total, excluidosInactivos: r.excl };
  }

  @Get(':id/revision')
  async revision(@Usuario() s: Sesion, @Param('id', ParseUUIDPipe) id: string): Promise<{ items: RevisionItem[]; destinatarios: number; excluidosInactivos: number; tope: number; dias: number; html: string }> {
    return this.db.tx(s.empresaId, async (c) => {
      const camp = (await c.query('SELECT * FROM campanas WHERE id=$1', [id])).rows[0];
      if (!camp) throw new NotFoundException();
      const emp = (await c.query('SELECT * FROM empresas')).rows[0];
      const p = camp.plantilla_id ? (await c.query('SELECT diseno FROM plantillas WHERE id=$1', [camp.plantilla_id])).rows[0] : null;
      const html = camp.estado !== 'borrador' && camp.html ? camp.html : p ? await htmlDeDiseno(c, p.diseno, camp.preencabezado) : '';
      const d = await this.destinatarios(c, camp);
      const { tope } = topeDelDia(emp);
      const items = revisar({
        asunto: camp.asunto, asuntoB: camp.ab_porcentaje > 0 ? camp.asunto_b : '', preencabezado: camp.preencabezado, html,
        dominioEnvio: emp.dominio_envio, fromEmail: emp.from_email, destinatarios: d.total, topeDiario: tope,
      });
      if (camp.ab_porcentaje > 0 && !camp.asunto_b) items.unshift({ nivel: 'error', mensaje: 'Activó la prueba A/B pero falta el asunto B.' });
      return { items, destinatarios: d.total, excluidosInactivos: d.excluidosInactivos, tope, dias: Math.ceil(d.total / Math.max(1, tope)), html };
    });
  }

  @Roles('admin', 'editor')
  @Post(':id/prueba')
  @HttpCode(200)
  async prueba(@Usuario() s: Sesion, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PruebaDto) {
    const { camp, emp, html } = await this.db.tx(s.empresaId, async (c) => {
      const camp = (await c.query('SELECT * FROM campanas WHERE id=$1', [id])).rows[0];
      if (!camp?.plantilla_id) throw new BadRequestException('Elija el contenido antes de enviar una prueba');
      const emp = (await c.query('SELECT * FROM empresas')).rows[0];
      if (!emp.from_email) throw new BadRequestException('Configure el remitente primero');
      const p = (await c.query('SELECT diseno FROM plantillas WHERE id=$1', [camp.plantilla_id])).rows[0];
      return { camp, emp, html: await htmlDeDiseno(c, p.diseno, camp.preencabezado) };
    });
    const res: string[] = [];
    for (const correo of dto.correos) {
      for (const [v, asunto] of [['A', camp.asunto], ['B', camp.asunto_b]] as const) {
        if (v === 'B' && !(camp.ab_porcentaje > 0 && asunto)) continue;
        try {
          await this.correo.enviar(
            { empresaId: s.empresaId, fromEmail: emp.from_email, fromNombre: emp.from_nombre, replyTo: emp.reply_to },
            { id: 0, email: correo.toLowerCase(), nombre: 'Prueba', compania: 'Empresa de prueba', ciudad: 'Cali', cargo: '' },
            { campanaId: null, asunto: `[Prueba${v === 'B' ? ' B' : ''}] ${asunto}`, html });
          res.push(`${correo}: enviada${v === 'B' ? ' (asunto B)' : ''}`);
        } catch (e) {
          res.push(`${correo}: error — ${(e as Error).message}`);
        }
      }
    }
    return { resultados: res };
  }

  @Roles('admin', 'editor')
  @Post(':id/enviar')
  @HttpCode(200)
  async enviar(@Usuario() s: Sesion, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EnviarDto) {
    const rev = await this.revision(s, id);
    if (rev.items.some((i) => i.nivel === 'error')) throw new BadRequestException('Corrija los errores de la revisión antes de enviar');
    const cuando = dto.programada_para ? new Date(dto.programada_para) : new Date();
    if (cuando.getTime() < Date.now() - 60_000) throw new BadRequestException('La fecha programada ya pasó');
    await this.db.tx(s.empresaId, (c) => c.query(
      `UPDATE campanas SET estado='programada', programada_para=$2 WHERE id=$1 AND estado='borrador'`, [id, cuando]));
    return { estado: 'programada', programada_para: cuando };
  }

  @Roles('admin', 'editor')
  @Post(':id/pausar')
  @HttpCode(200)
  async pausar(@Usuario() s: Sesion, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.tx(s.empresaId, (c) => c.query(
      `UPDATE campanas SET estado = CASE WHEN estado='programada' AND iniciada IS NULL THEN 'borrador' ELSE 'pausada' END,
         motivo_pausa='Pausada manualmente' WHERE id=$1 AND estado IN ('programada','enviando','prueba_ab')`, [id]));
    return { ok: true };
  }

  @Roles('admin', 'editor')
  @Post(':id/reanudar')
  @HttpCode(200)
  async reanudar(@Usuario() s: Sesion, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.tx(s.empresaId, (c) => c.query(
      `UPDATE campanas SET estado = CASE WHEN ab_porcentaje>0 AND ab_ganador IS NULL THEN 'prueba_ab' ELSE 'enviando' END,
         motivo_pausa='' WHERE id=$1 AND estado='pausada'`, [id]));
    return { ok: true };
  }
}
