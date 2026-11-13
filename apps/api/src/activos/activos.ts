import {
  BadRequestException, Controller, Get, Injectable, Post, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { DbService, type Cliente } from '../comun/db.service.js';
import { Roles, Usuario, type Sesion } from '../comun/seguridad.js';
import { config } from '../config.js';

const MAX = 5 * 1024 * 1024;

/** Tipo real por la firma del archivo (no por la extensión ni por lo que diga el navegador). */
export function tipoImagen(b: Buffer): { mime: string; ext: string } | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a') return { mime: 'image/gif', ext: 'gif' };
  if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

@Injectable()
export class AlmacenService {
  private s3 = config.s3Bucket ? new S3Client({ region: config.awsRegion }) : null;

  /** Guarda la imagen (S3 + CloudFront en la nube, disco local en desarrollo) y la registra. */
  async guardar(c: Cliente, empresaId: string, nombre: string, datos: Buffer) {
    if (datos.length > MAX) throw new BadRequestException('Imagen de más de 5 MB. Comprímala antes de subirla.');
    const t = tipoImagen(datos);
    if (!t) throw new BadRequestException('Solo se permiten imágenes JPG, PNG, GIF o WEBP');
    const clave = `${empresaId}/${randomUUID()}.${t.ext}`;
    let url: string;
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({
        Bucket: config.s3Bucket, Key: clave, Body: datos, ContentType: t.mime, CacheControl: 'public, max-age=31536000, immutable',
      }));
      url = `${config.s3UrlPublica}/${clave}`;
    } else {
      // Sin S3: la imagen se guarda en PostgreSQL y la sirve la propia app (sobrevive a los redespliegues)
      url = `${config.urlPublica}/archivos/${clave}`;
    }
    const limpio = nombre.replace(/[^\w.\- ]+/g, '').slice(0, 120) || `imagen.${t.ext}`;
    return (await c.query(
      'INSERT INTO activos(empresa_id,nombre,mime,tamano,clave,url,datos) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,nombre,url,mime,tamano,creado',
      [empresaId, limpio, t.mime, datos.length, clave, url, this.s3 ? null : datos])).rows[0];
  }
}

@Controller('activos')
export class ActivosController {
  constructor(private db: DbService, private almacen: AlmacenService) {}

  @Get()
  async listar(@Usuario() s: Sesion) {
    return this.db.tx(s.empresaId, async (c) =>
      (await c.query('SELECT id,nombre,url,mime,tamano,creado FROM activos ORDER BY creado DESC LIMIT 200')).rows);
  }

  @Roles('admin', 'editor')
  @Post()
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: MAX } }))
  async subir(@Usuario() s: Sesion, @UploadedFile() f: Express.Multer.File) {
    if (!f) throw new BadRequestException('Adjunte una imagen');
    return this.db.tx(s.empresaId, (c) => this.almacen.guardar(c, s.empresaId, f.originalname, f.buffer));
  }
}
