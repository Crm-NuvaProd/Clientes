import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put,
} from '@nestjs/common';
import type { DisenoCorreo, Plantilla, PlantillaResumen } from '@nuvamail/contratos';
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { AlmacenService } from '../activos/activos.js';
import { DbService, type Cliente } from '../comun/db.service.js';
import { Roles, Usuario, type Sesion } from '../comun/seguridad.js';
import { AJUSTES_DEFECTO, agregarPie, limpiarCorreo, renderizar, type Pie } from './render.js';

const TIPOS = ['encabezado', 'texto', 'imagen', 'boton', 'columnas', 'divisor', 'espaciador', 'redes', 'html'];

class PlantillaDto {
  @IsString() @MaxLength(150) nombre: string;
  @IsObject() diseno: DisenoCorreo;
}
class VistaDto {
  @IsObject() diseno: DisenoCorreo;
  @IsOptional() @IsString() @MaxLength(200) preencabezado?: string;
}
class ImportarDto {
  @IsString() @MaxLength(150) nombre: string;
  @IsIn(['auto', 'json', 'html']) formato: 'auto' | 'json' | 'html';
  @IsString() @MaxLength(3_000_000) contenido: string;
}

/** Valida y normaliza un diseño (del editor o generado por Claude). */
export function validarDiseno(d: any): DisenoCorreo {
  if (!d || typeof d !== 'object' || !Array.isArray(d.bloques)) throw new BadRequestException('Diseño inválido: falta "bloques"');
  if (d.bloques.length > 80) throw new BadRequestException('Máximo 80 bloques por correo');
  const bloques = d.bloques.map((b: any) => {
    if (!b || !TIPOS.includes(b.tipo)) throw new BadRequestException(`Tipo de bloque no soportado: ${b?.tipo}`);
    return { ...b, id: typeof b.id === 'string' && b.id ? b.id.slice(0, 40) : randomUUID() };
  });
  return { formato: 'nuvamail/1', ajustes: { ...AJUSTES_DEFECTO, ...(d.ajustes ?? {}) }, bloques };
}

export async function pieEmpresa(c: Cliente): Promise<Pie> {
  const e = (await c.query('SELECT pie_legal, url_politica, direccion FROM empresas')).rows[0];
  return { texto: e?.pie_legal ?? '', urlPolitica: e?.url_politica ?? '', direccion: e?.direccion ?? '' };
}

/** HTML final (sin personalizar) de un diseño, con el pie legal. */
export async function htmlDeDiseno(c: Cliente, d: DisenoCorreo, preencabezado = ''): Promise<string> {
  const pie = await pieEmpresa(c);
  const soloHtml = d.bloques.length === 1 && d.bloques[0].tipo === 'html' && /<html|<table/i.test(d.bloques[0].html);
  if (soloHtml) return agregarPie(limpiarCorreo((d.bloques[0] as any).html), pie);
  return (await renderizar(d, preencabezado, pie)).html;
}

@Controller('plantillas')
export class PlantillasController {
  constructor(private db: DbService, private almacen: AlmacenService) {}

  @Get()
  async listar(@Usuario() s: Sesion): Promise<PlantillaResumen[]> {
    return this.db.tx(s.empresaId, async (c) =>
      (await c.query('SELECT id,nombre,origen,actualizado FROM plantillas ORDER BY actualizado DESC')).rows);
  }

  @Get(':id')
  async obtener(@Usuario() s: Sesion, @Param('id', ParseUUIDPipe) id: string): Promise<Plantilla> {
    const p = await this.db.tx(s.empresaId, async (c) => (await c.query('SELECT * FROM plantillas WHERE id=$1', [id])).rows[0]);
    if (!p) throw new NotFoundException();
    return p;
  }

  @Roles('admin', 'editor')
  @Post()
  async crear(@Usuario() s: Sesion, @Body() dto: PlantillaDto) {
    const d = validarDiseno(dto.diseno);
    return this.db.tx(s.empresaId, async (c) => (await c.query(
      'INSERT INTO plantillas(empresa_id,nombre,diseno,html) VALUES ($1,$2,$3,$4) RETURNING id,nombre,origen,actualizado',
      [s.empresaId, dto.nombre, d, await htmlDeDiseno(c, d)])).rows[0]);
  }

  @Roles('admin', 'editor')
  @Put(':id')
  async guardar(@Usuario() s: Sesion, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PlantillaDto) {
    const d = validarDiseno(dto.diseno);
    return this.db.tx(s.empresaId, async (c) => {
      const r = await c.query(
        'UPDATE plantillas SET nombre=$2, diseno=$3, html=$4, actualizado=now() WHERE id=$1 RETURNING id,nombre,origen,actualizado',
        [id, dto.nombre, d, await htmlDeDiseno(c, d)]);
      if (!r.rowCount) throw new NotFoundException();
      return r.rows[0];
    });
  }

  @Roles('admin', 'editor')
  @Post(':id/duplicar')
  async duplicar(@Usuario() s: Sesion, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.tx(s.empresaId, async (c) => (await c.query(
      `INSERT INTO plantillas(empresa_id,nombre,origen,diseno,html) SELECT empresa_id, nombre||' (copia)', origen, diseno, html
       FROM plantillas WHERE id=$1 RETURNING id,nombre,origen,actualizado`, [id])).rows[0]);
  }

  @Roles('admin', 'editor')
  @Delete(':id')
  @HttpCode(204)
  async borrar(@Usuario() s: Sesion, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.tx(s.empresaId, (c) => c.query('DELETE FROM plantillas WHERE id=$1 AND id NOT IN (SELECT plantilla_id FROM campanas WHERE plantilla_id IS NOT NULL)', [id]));
  }

  /** Vista previa en vivo del editor. */
  @Post('vista-previa')
  @HttpCode(200)
  async vista(@Usuario() s: Sesion, @Body() dto: VistaDto) {
    const d = validarDiseno(dto.diseno);
    const html = await this.db.tx(s.empresaId, (c) => htmlDeDiseno(c, d, dto.preencabezado));
    const kb = Buffer.byteLength(html) / 1024;
    return { html, kb: Math.round(kb), avisoTamano: kb > 95 ? 'Gmail recorta correos de más de ~102 KB' : '' };
  }

  /**
   * Importa una pieza diseñada por Claude: JSON con formato "nuvamail/1" (queda editable bloque a bloque)
   * o HTML de correo completo. Las imágenes incrustadas (data:) se suben al almacén y se reemplazan por URL.
   */
  @Roles('admin', 'editor')
  @Post('importar')
  async importar(@Usuario() s: Sesion, @Body() dto: ImportarDto) {
    let texto = dto.contenido.trim();
    const bloqueJson = texto.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (bloqueJson) texto = bloqueJson[1].trim();
    const esJson = dto.formato === 'json' || (dto.formato === 'auto' && texto.startsWith('{'));
    return this.db.tx(s.empresaId, async (c) => {
      let diseno: DisenoCorreo;
      let origen: 'claude' | 'html' = 'claude';
      let subidas = 0;
      const rehospedar = async (html: string) => {
        const re = /data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)/g;
        const vistos = new Map<string, string>();
        for (const m of html.matchAll(re)) {
          if (vistos.has(m[0])) continue;
          const a = await this.almacen.guardar(c, s.empresaId, `importada-${vistos.size + 1}`, Buffer.from(m[2], 'base64'));
          vistos.set(m[0], a.url);
          subidas++;
        }
        for (const [k, v] of vistos) html = html.split(k).join(v);
        return html;
      };
      if (esJson) {
        let obj: any;
        try { obj = JSON.parse(texto); } catch { throw new BadRequestException('El JSON no es válido'); }
        diseno = validarDiseno(obj.diseno ?? obj);
        const txt = await rehospedar(JSON.stringify(diseno));
        diseno = JSON.parse(txt);
      } else {
        if (!/<(table|div|p|body|html)\b/i.test(texto)) throw new BadRequestException('No parece HTML de correo ni JSON de NuvaMail');
        const html = await rehospedar(limpiarCorreo(texto));
        diseno = validarDiseno({ bloques: [{ tipo: 'html', html }] });
        origen = 'html';
      }
      const fila = (await c.query(
        'INSERT INTO plantillas(empresa_id,nombre,origen,diseno,html) VALUES ($1,$2,$3,$4,$5) RETURNING id,nombre,origen,actualizado',
        [s.empresaId, dto.nombre, origen, diseno, await htmlDeDiseno(c, diseno)])).rows[0];
      return { ...fila, bloques: diseno.bloques.length, imagenesSubidas: subidas, editable: esJson };
    });
  }
}
