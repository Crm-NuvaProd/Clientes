import { Controller, Get, Header, HttpCode, Logger, NotFoundException, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createVerify } from 'node:crypto';
import { DbService } from '../comun/db.service.js';
import { limitar, Publico } from '../comun/seguridad.js';
import { config } from '../config.js';
import { EventosService, type TipoEvento } from '../envio/eventos.service.js';
import { leerTokenBaja } from '../envio/token-baja.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const pagina = (titulo: string, cuerpo: string) => `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${titulo}</title>
<style>body{margin:0;font-family:Arial,sans-serif;background:#f4f6fa;color:#1f2937}.c{max-width:460px;margin:80px auto;background:#fff;
border:1px solid #e3e7ef;border-radius:12px;padding:32px;text-align:center}h1{color:#0A2342;font-size:20px}
button{background:#0A2342;color:#fff;border:0;border-radius:8px;padding:12px 22px;font-size:15px;cursor:pointer}</style></head>
<body><div class="c">${cuerpo}</div></body></html>`;

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;
const CAMPOS_FIRMA: Record<string, string[]> = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
};
const certs = new Map<string, string>();
const urlAws = (u: string) => { try { const x = new URL(u); return x.protocol === 'https:' && SNS_HOST.test(x.hostname); } catch { return false; } };

export async function verificarSns(m: any, obtenerCert = async (u: string) => (await fetch(u)).text()): Promise<boolean> {
  const campos = CAMPOS_FIRMA[m?.Type];
  if (!campos) return false;
  if (config.snsTopicArn && m.TopicArn !== config.snsTopicArn) return false;
  if (!urlAws(m.SigningCertURL)) return false;
  let pem = certs.get(m.SigningCertURL);
  if (!pem) { pem = await obtenerCert(m.SigningCertURL); certs.set(m.SigningCertURL, pem); }
  const texto = campos.filter((k) => m[k] !== undefined && m[k] !== null).map((k) => `${k}\n${m[k]}\n`).join('');
  try {
    return createVerify(String(m.SignatureVersion) === '2' ? 'RSA-SHA256' : 'RSA-SHA1').update(texto).verify(pem, m.Signature, 'base64');
  } catch { return false; }
}

@Publico()
@Controller()
export class PublicoController {
  private log = new Logger('Publico');
  constructor(private db: DbService, private eventos: EventosService) {}

  @Get('u/:token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async paginaBaja(@Param('token') token: string, @Req() req: Request) {
    limitar(req, 'baja', 60, 60_000);
    const t = leerTokenBaja(token);
    if (!t) throw new NotFoundException('Enlace no válido');
    const email = await this.db.tx(t.empresaId, async (c) => (await c.query('SELECT email FROM contactos WHERE id=$1', [t.contactoId])).rows[0]?.email ?? '');
    // GET no da de baja: los antivirus corporativos abren los enlaces y darían de baja a todos
    return pagina('Cancelar suscripción', `<h1>¿Cancelar la suscripción?</h1><p>Dejará de recibir correos en <b>${esc(email)}</b>.</p>
      <form method="post"><button>Sí, cancelar suscripción</button></form>`);
  }

  /** Botón de la página y baja en un clic RFC 8058 (Gmail/Yahoo/Outlook hacen POST sin confirmación). */
  @Post('u/:token')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async baja(@Param('token') token: string, @Req() req: Request) {
    limitar(req, 'baja', 60, 60_000);
    const t = leerTokenBaja(token);
    if (!t) throw new NotFoundException('Enlace no válido');
    const email = await this.db.tx(t.empresaId, async (c) => {
      const ct = (await c.query('SELECT email, estado FROM contactos WHERE id=$1', [t.contactoId])).rows[0];
      if (ct?.estado === 'activo') {
        await this.eventos.registrar(c, { empresaId: t.empresaId, campanaId: t.campanaId, contactoId: t.contactoId, tipo: 'baja',
          detalle: req.body?.['List-Unsubscribe'] === 'One-Click' ? 'Baja en un clic (proveedor de correo)' : 'Baja por enlace' });
      }
      return ct?.email ?? '';
    });
    return pagina('Suscripción cancelada', `<h1>Listo, se canceló su suscripción</h1>
      <p>${esc(email)} no recibirá más correos de marketing.</p><p style="color:#6b7280;font-size:13px">Si fue un error, responda cualquiera de nuestros correos.</p>`);
  }

  /** Imágenes de las piezas guardadas en la base (cuando no hay S3). */
  @Get('archivos/:empresa/:archivo')
  async archivo(@Param('empresa') empresa: string, @Param('archivo') archivo: string, @Res() res: Response) {
    if (!/^[0-9a-f-]{36}$/.test(empresa) || !/^[0-9a-f-]{36}\.(jpg|png|gif|webp)$/.test(archivo)) throw new NotFoundException();
    const [a] = await this.db.sistema('SELECT mime, datos FROM activo_publico($1)', [`${empresa}/${archivo}`]);
    if (!a) throw new NotFoundException();
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // Las cargan clientes de correo de otros orígenes (Outlook web, Gmail)
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Disposition', 'inline');
    res.end(a.datos);
  }

  /** Eventos de Amazon SES vía SNS: rebotes, quejas, entregas, aperturas y clics. */
  @Post('ses/eventos')
  @HttpCode(200)
  async ses(@Req() req: Request) {
    let m: any;
    try { m = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return 'json inválido'; }
    if (!(await verificarSns(m))) { this.log.warn('Firma SNS inválida'); throw new NotFoundException(); }
    if (m.Type === 'SubscriptionConfirmation') {
      if (urlAws(m.SubscribeURL)) await fetch(m.SubscribeURL);
      return 'confirmado';
    }
    if (m.Type !== 'Notification') return 'ignorado';
    try { await this.procesarSes(JSON.parse(m.Message)); } catch (e) { this.log.error(`Evento SES: ${(e as Error).message}`); }
    return 'ok';
  }

  async procesarSes(ev: any) {
    const tipo: string = ev.eventType ?? ev.notificationType;
    const mail = ev.mail ?? {};
    const tag = (k: string) => (mail.tags?.[k]?.[0] as string | undefined);
    let empresaId = tag('empresa_id');
    let campanaId: string | null = tag('campana_id') ?? null;
    let contactoId = Number(tag('contacto_id')) || null;
    let variante = tag('variante') ?? null;
    if (!empresaId && mail.messageId) {
      const [e] = await this.db.sistema('SELECT * FROM envio_por_mensaje($1)', [mail.messageId]);
      if (!e) return;
      ({ empresa_id: empresaId, campana_id: campanaId, contacto_id: contactoId, variante } = e);
    }
    if (!empresaId || !/^[0-9a-f-]{36}$/.test(empresaId)) return;
    if (campanaId === 'prueba' || (campanaId && !/^[0-9a-f-]{36}$/.test(campanaId))) campanaId = null;
    const dominio = String(mail.destination?.[0] ?? '').split('@')[1] ?? '';
    const base = { empresaId, campanaId, contactoId, variante, dominio };
    await this.db.tx(empresaId, async (c) => {
      const reg = (t: TipoEvento, extra: Record<string, unknown> = {}) => this.eventos.registrar(c, { ...base, tipo: t, ...extra });
      switch (tipo) {
        case 'Bounce': {
          const b = ev.bounce;
          const t: TipoEvento = b.bounceType === 'Permanent' ? 'rebote_duro' : 'rebote_suave';
          const r = b.bouncedRecipients?.[0] ?? {};
          return reg(t, { detalle: `${b.bounceSubType ?? ''} ${r.diagnosticCode ?? ''}`.trim() });
        }
        case 'Complaint': return reg('queja', { detalle: ev.complaint?.complaintFeedbackType ?? '' });
        case 'Delivery': return reg('entregado');
        case 'Open': return reg('apertura', { userAgent: ev.open?.userAgent ?? '' });
        case 'Click': return reg('clic', { url: ev.click?.link ?? '', userAgent: ev.click?.userAgent ?? '' });
        case 'Reject': return reg('rechazado', { detalle: ev.reject?.reason ?? '' });
        case 'RenderingFailure': return reg('rechazado', { detalle: ev.failure?.errorMessage ?? 'Error de renderizado' });
        case 'DeliveryDelay': return reg('retraso', { detalle: ev.deliveryDelay?.delayType ?? '' });
      }
    });
  }
}
