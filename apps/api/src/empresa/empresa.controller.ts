import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
import type { ChequeoDns } from '@nuvamail/contratos';
import { ArrayMaxSize, IsArray, IsDateString, IsEmail, IsInt, IsNumber, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { promises as dns } from 'node:dns';
import { DbService } from '../comun/db.service.js';
import { Roles, Usuario, type Sesion } from '../comun/seguridad.js';
import { enviadosHoy, topeDelDia } from '../envio/trabajador.service.js';

class EmpresaDto {
  @IsString() @MaxLength(150) nombre: string;
  @IsString() @Matches(/^([a-z0-9-]+\.)+[a-z]{2,}$/i, { message: 'Dominio no válido' }) dominio_envio: string;
  @IsEmail() from_email: string;
  @IsString() @MaxLength(80) from_nombre: string;
  @IsEmail() reply_to: string;
  @IsString() @MaxLength(400) pie_legal: string;
  @ValidateIf((o) => o.url_politica !== '') @IsUrl({ protocols: ['https'] }) url_politica: string;
  @IsString() @MaxLength(200) direccion: string;
  @IsOptional() @IsDateString() warmup_inicio?: string | null;
  @IsArray() @ArrayMaxSize(30) @IsInt({ each: true }) @Min(50, { each: true }) warmup_plan: number[];
  @IsInt() @Min(100) @Max(1_000_000) tope_diario: number;
  @IsNumber() @Min(0.5) @Max(50) ritmo_seg: number;
  @IsInt() @Min(5) @Max(1000) tope_dominio_min: number;
}

async function txt(nombre: string): Promise<string[]> {
  try { return (await dns.resolveTxt(nombre)).map((r) => r.join('')); } catch { return []; }
}
async function cname(nombre: string): Promise<string> {
  try { return (await dns.resolveCname(nombre))[0] ?? ''; } catch { return ''; }
}
async function mx(nombre: string): Promise<string[]> {
  try { return (await dns.resolveMx(nombre)).map((m) => m.exchange); } catch { return []; }
}

@Controller('empresa')
export class EmpresaController {
  constructor(private db: DbService) {}

  @Get()
  async obtener(@Usuario() s: Sesion) {
    return this.db.tx(s.empresaId, async (c) => (await c.query('SELECT * FROM empresas')).rows[0]);
  }

  @Roles('admin')
  @Put()
  async guardar(@Usuario() s: Sesion, @Body() d: EmpresaDto) {
    if (!d.from_email.toLowerCase().endsWith(`@${d.dominio_envio.toLowerCase()}`)) {
      throw new BadRequestException(`El remitente debe ser una dirección de ${d.dominio_envio}`);
    }
    return this.db.tx(s.empresaId, async (c) => (await c.query(
      `UPDATE empresas SET nombre=$1, dominio_envio=lower($2), from_email=lower($3), from_nombre=$4, reply_to=lower($5), pie_legal=$6,
         url_politica=$7, direccion=$8, warmup_inicio=$9, warmup_plan=$10, tope_diario=$11, ritmo_seg=$12, tope_dominio_min=$13
       RETURNING *`,
      [d.nombre, d.dominio_envio, d.from_email, d.from_nombre, d.reply_to, d.pie_legal, d.url_politica, d.direccion,
       d.warmup_inicio || null, d.warmup_plan, d.tope_diario, d.ritmo_seg, d.tope_dominio_min])).rows[0]);
  }

  /** Estado de autenticación del dominio y del calentamiento (pestaña Entregabilidad). */
  @Get('entregabilidad')
  async entregabilidad(@Usuario() s: Sesion) {
    const { emp, hoy } = await this.db.tx(s.empresaId, async (c) => ({
      emp: (await c.query('SELECT * FROM empresas')).rows[0], hoy: await enviadosHoy(c),
    }));
    const d: string = emp.dominio_envio;
    const chequeos: ChequeoDns[] = [];
    if (d) {
      const bounce = `bounce.${d}`;
      const spf = (await txt(bounce)).find((r) => r.toLowerCase().startsWith('v=spf1')) ?? '';
      chequeos.push({ registro: 'SPF (MAIL FROM)', nombre: bounce, estado: spf.includes('amazonses.com') ? 'ok' : spf ? 'revisar' : 'falta',
        valor: spf, esperado: 'v=spf1 include:amazonses.com ~all' });
      const mxs = await mx(bounce);
      chequeos.push({ registro: 'MX (MAIL FROM)', nombre: bounce, estado: mxs.some((m) => m.includes('amazonses.com')) ? 'ok' : 'falta',
        valor: mxs.join(', '), esperado: '10 feedback-smtp.<region>.amazonses.com' });
      let dmarc = (await txt(`_dmarc.${d}`)).find((r) => /^v=dmarc1/i.test(r)) ?? '';
      let origen = d;
      if (!dmarc) { origen = d.split('.').slice(-2).join('.'); dmarc = (await txt(`_dmarc.${origen}`)).find((r) => /^v=dmarc1/i.test(r)) ?? ''; }
      chequeos.push({ registro: 'DMARC', nombre: `_dmarc.${origen}`, estado: dmarc ? (/rua=/i.test(dmarc) ? 'ok' : 'revisar') : 'falta',
        valor: dmarc, esperado: 'v=DMARC1; p=none; rua=mailto:dmarc@su-dominio (luego quarantine/reject)' });
      // DKIM: SES publica 3 CNAME con tokens; sin los tokens se verifica desde la consola de SES
      const dk = await cname(`_amazonses.${d}`);
      chequeos.push({ registro: 'DKIM', nombre: `<token>._domainkey.${d}`, estado: 'revisar', valor: dk,
        esperado: '3 CNAME hacia <token>.dkim.amazonses.com (ver consola SES → Identities)' });
    }
    const { tope, dia } = topeDelDia(emp);
    return {
      dominio: d, chequeos, enviadosHoy: hoy, topeHoy: tope, diaCalentamiento: dia, plan: emp.warmup_plan,
      estrategias: [
        'Autenticación SPF + DKIM + DMARC alineada con el dominio del remitente.',
        'Subdominio dedicado a marketing para proteger el correo corporativo.',
        'Calentamiento: tope diario creciente durante los primeros 7 días.',
        'Envío priorizado: primero los contactos que más interactúan.',
        `Máximo ${emp.tope_dominio_min} correos por minuto a un mismo dominio (evita bloqueos de servidores corporativos).`,
        'Validación al importar: sintaxis, MX, errores de digitación y dominios desechables.',
        'Supresión automática: rebote duro, 3 rebotes temporales seguidos, quejas y bajas.',
        'Política de inactividad opcional por campaña (excluye a quien no interactúa).',
        'Baja en un clic (RFC 8058) y enlace visible en el pie.',
        'Pausa automática si rebotes o quejas superan el umbral.',
        'Revisión de contenido antes de enviar y prueba A/B con una muestra.',
      ],
    };
  }
}
