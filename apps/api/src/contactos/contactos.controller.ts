import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Query,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Contacto, Lista, Pagina, ResultadoImportacion } from '@nuvamail/contratos';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { parse } from 'csv-parse/sync';
import { DbService } from '../comun/db.service.js';
import { Roles, Usuario, type Sesion } from '../comun/seguridad.js';
import { decodificar, mapearColumnas, normalizar, revisarCorreo } from './validacion.js';

class FiltroContactos {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['activo', 'baja', 'rebote', 'queja', 'invalido']) estado?: string;
  @IsOptional() @IsUUID() lista?: string;
  @IsOptional() @IsIn(['comprometidos', 'inactivos90', 'nunca']) segmento?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) pageSize = 50;
}

class ImportarDto {
  @IsOptional() @IsUUID() lista_id?: string;
  @IsOptional() @IsString() @MaxLength(200) origen?: string;
  @IsOptional() @IsIn(['true', 'false']) verificar_mx?: string;
  @IsIn(['true'], { message: 'Debe confirmar que los contactos autorizaron recibir comunicaciones (Ley 1581)' }) confirmo_autorizacion: string;
}

class ListaDto {
  @IsString() @MaxLength(120) nombre: string;
  @IsOptional() @IsString() @MaxLength(500) descripcion?: string;
}

const SEGMENTOS: Record<string, string> = {
  comprometidos: "ultima_interaccion > now() - interval '90 days'",
  inactivos90: "envios >= 3 AND (ultima_interaccion IS NULL OR ultima_interaccion < now() - interval '90 days')",
  nunca: 'envios = 0',
};

@Controller('contactos')
export class ContactosController {
  constructor(private db: DbService) {}

  @Get()
  async listar(@Usuario() s: Sesion, @Query() f: FiltroContactos): Promise<Pagina<Contacto>> {
    const cond: string[] = ['TRUE'];
    const p: unknown[] = [];
    if (f.q) { p.push(`%${f.q.toLowerCase()}%`); cond.push(`(email LIKE $${p.length} OR lower(nombre) LIKE $${p.length} OR lower(compania) LIKE $${p.length})`); }
    if (f.estado) { p.push(f.estado); cond.push(`estado = $${p.length}`); }
    if (f.lista) { p.push(f.lista); cond.push(`id IN (SELECT contacto_id FROM lista_contactos WHERE lista_id = $${p.length})`); }
    if (f.segmento) cond.push(SEGMENTOS[f.segmento]);
    const where = cond.join(' AND ');
    return this.db.tx(s.empresaId, async (c) => {
      const total = (await c.query(`SELECT count(*) n FROM contactos WHERE ${where}`, p)).rows[0].n;
      const data = (await c.query(
        `SELECT id,email,nombre,compania,ciudad,cargo,estado,estado_motivo,origen_consentimiento,envios,aperturas,clics,
                ultima_interaccion,creado FROM contactos WHERE ${where} ORDER BY id DESC
         LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`, p)).rows;
      return { data, total, page: f.page, pageSize: f.pageSize };
    });
  }

  @Roles('admin', 'editor')
  @Post('importar')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async importar(@Usuario() s: Sesion, @UploadedFile() archivo: Express.Multer.File, @Body() dto: ImportarDto): Promise<ResultadoImportacion> {
    if (!archivo) throw new BadRequestException('Adjunte un archivo CSV');
    const texto = decodificar(archivo.buffer);
    if (/\x00/.test(texto.slice(0, 2000))) throw new BadRequestException('El archivo no es un CSV de texto (si es Excel, guárdelo como CSV)');
    const linea1 = texto.split(/\r?\n/, 1)[0];
    const delimitador = [';', ',', '\t', '|'].sort((a, b) => linea1.split(b).length - linea1.split(a).length)[0];
    let filas: Record<string, string>[];
    try {
      filas = parse(texto, { columns: true, delimiter: delimitador, skip_empty_lines: true, trim: true, relax_column_count: true });
    } catch {
      throw new BadRequestException('No se pudo leer el CSV. Revise el formato.');
    }
    if (filas.length > 200_000) throw new BadRequestException('Máximo 200.000 filas por archivo');
    const mapa = mapearColumnas(Object.keys(filas[0] ?? {}));
    if (!Object.values(mapa).includes('email')) throw new BadRequestException("El archivo debe tener una columna 'email' o 'correo'");

    const r: ResultadoImportacion = { leidos: filas.length, nuevos: 0, actualizados: 0, duplicados: 0, invalidos: 0,
      genericos: 0, suprimidosRespetados: 0, descartados: [] };
    const vistos = new Set<string>();
    const validos: Record<string, string>[] = [];
    const mx = dto.verificar_mx !== 'false';
    // Valida en paralelo por lotes (la consulta MX se cachea por dominio)
    for (let i = 0; i < filas.length; i += 200) {
      const lote = filas.slice(i, i + 200).map((f) => {
        const o: Record<string, string> = {};
        for (const [col, campo] of Object.entries(mapa)) o[campo] = String(f[col] ?? '').slice(0, 300);
        o.email = normalizar(o.email);
        return o;
      });
      const revisados = await Promise.all(lote.map((o) => (o.email ? revisarCorreo(o.email, mx) : null)));
      lote.forEach((o, j) => {
        const rv = revisados[j];
        if (!rv) return;
        if (vistos.has(o.email)) { r.duplicados++; return; }
        vistos.add(o.email);
        if (rv.estado === 'invalido') {
          r.invalidos++;
          if (r.descartados.length < 300) r.descartados.push({ email: o.email, motivo: rv.motivo });
          return;
        }
        if (rv.estado === 'generico') r.genericos++;
        validos.push(o);
      });
    }

    await this.db.tx(s.empresaId, async (c) => {
      for (let i = 0; i < validos.length; i += 1000) {
        const lote = validos.slice(i, i + 1000);
        const fecha = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? '') ? v : null);
        // Inserción idempotente: nunca reactiva contactos dados de baja, rebotados o con queja
        const res = await c.query(
          `INSERT INTO contactos (empresa_id, email, nombre, compania, ciudad, cargo, origen_consentimiento, fecha_consentimiento)
           SELECT $1, x.email, x.nombre, x.compania, x.ciudad, x.cargo, x.origen, x.fecha::date
           FROM jsonb_to_recordset($2::jsonb) AS x(email text, nombre text, compania text, ciudad text, cargo text, origen text, fecha text)
           ON CONFLICT (empresa_id, email) DO UPDATE SET
             nombre = COALESCE(NULLIF(EXCLUDED.nombre,''), contactos.nombre),
             compania = COALESCE(NULLIF(EXCLUDED.compania,''), contactos.compania),
             ciudad = COALESCE(NULLIF(EXCLUDED.ciudad,''), contactos.ciudad),
             cargo = COALESCE(NULLIF(EXCLUDED.cargo,''), contactos.cargo),
             origen_consentimiento = COALESCE(NULLIF(EXCLUDED.origen_consentimiento,''), contactos.origen_consentimiento),
             actualizado = now()
           RETURNING id, (xmax = 0) AS nuevo, estado`,
          [s.empresaId, JSON.stringify(lote.map((o) => ({
            email: o.email, nombre: o.nombre ?? '', compania: o.compania ?? '', ciudad: o.ciudad ?? '', cargo: o.cargo ?? '',
            origen: o.origen || dto.origen || '', fecha: fecha(o.fecha),
          })))],
        );
        for (const row of res.rows) {
          if (row.nuevo) r.nuevos++; else r.actualizados++;
          if (row.estado !== 'activo') r.suprimidosRespetados++;
        }
        if (dto.lista_id) {
          await c.query(
            `INSERT INTO lista_contactos(empresa_id, lista_id, contacto_id) SELECT $1, $2, unnest($3::bigint[]) ON CONFLICT DO NOTHING`,
            [s.empresaId, dto.lista_id, res.rows.map((x) => x.id)]);
        }
      }
    });
    return r;
  }

  @Roles('admin', 'editor')
  @Post(':id/baja')
  @HttpCode(204)
  async baja(@Usuario() s: Sesion, @Param('id', ParseIntPipe) id: number) {
    await this.db.tx(s.empresaId, (c) => c.query(
      "UPDATE contactos SET estado='baja', estado_motivo='Baja manual', actualizado=now() WHERE id=$1 AND estado='activo'", [id]));
  }

  /** Derecho de supresión (Ley 1581): borra los datos personales y deja solo una huella para no volver a escribirle. */
  @Roles('admin')
  @Delete(':id')
  @HttpCode(204)
  async suprimir(@Usuario() s: Sesion, @Param('id', ParseIntPipe) id: number) {
    await this.db.tx(s.empresaId, async (c) => {
      await c.query('DELETE FROM lista_contactos WHERE contacto_id=$1', [id]);
      await c.query(
        `UPDATE contactos SET email = 'suprimido-' || encode(digest(email, 'sha256'), 'hex') || '@invalid',
           nombre='', compania='', ciudad='', cargo='', atributos='{}', estado='baja',
           estado_motivo='Supresión de datos solicitada por el titular', actualizado=now() WHERE id=$1`, [id]);
    });
  }

  // ---------- Listas ----------
  @Get('listas/todas')
  async listas(@Usuario() s: Sesion): Promise<Lista[]> {
    return this.db.tx(s.empresaId, async (c) => (await c.query(
      `SELECT l.id, l.nombre, l.descripcion, count(lc.contacto_id) contactos,
              count(*) FILTER (WHERE ct.estado='activo') activos
       FROM listas l LEFT JOIN lista_contactos lc ON lc.lista_id=l.id LEFT JOIN contactos ct ON ct.id=lc.contacto_id
       GROUP BY l.id ORDER BY l.nombre`)).rows);
  }

  @Roles('admin', 'editor')
  @Post('listas')
  async crearLista(@Usuario() s: Sesion, @Body() dto: ListaDto) {
    return this.db.tx(s.empresaId, async (c) => (await c.query(
      'INSERT INTO listas(empresa_id,nombre,descripcion) VALUES ($1,$2,$3) RETURNING id,nombre,descripcion',
      [s.empresaId, dto.nombre, dto.descripcion ?? ''])).rows[0]);
  }

  @Roles('admin')
  @Delete('listas/:id')
  @HttpCode(204)
  async borrarLista(@Usuario() s: Sesion, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.tx(s.empresaId, (c) => c.query('DELETE FROM listas WHERE id=$1', [id]));
  }
}
