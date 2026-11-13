import { Injectable, Logger } from '@nestjs/common';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { aTexto, personalizar, type Variables } from '../plantillas/render.js';
import { urlBaja } from './token-baja.js';

export interface Remitente { empresaId: string; fromEmail: string; fromNombre: string; replyTo: string }
export interface Destinatario { id: number; email: string; nombre: string; compania: string; ciudad: string; cargo: string }
export interface Pieza { campanaId: string | null; asunto: string; html: string; variante?: string }

export function variables(r: Remitente, d: Destinatario, campanaId: string | null): Variables {
  return {
    nombre: (d.nombre || '').trim().split(/\s+/)[0] || '',
    nombre_completo: d.nombre || '', empresa: d.compania || '', ciudad: d.ciudad || '', cargo: d.cargo || '',
    email: d.email, url_baja: urlBaja(r.empresaId, d.id, campanaId),
  };
}

@Injectable()
export class CorreoService {
  private log = new Logger('Correo');
  private ses = new SESv2Client({ region: config.awsRegion });

  async construir(r: Remitente, d: Destinatario, p: Pieza): Promise<Buffer> {
    const v = variables(r, d, p.campanaId);
    const html = personalizar(p.html, v, true);
    const asunto = personalizar(p.asunto, v, false).replace(/[\r\n]+/g, ' ').trim();
    const dominio = r.fromEmail.split('@')[1];
    const composer = new MailComposer({
      from: { name: r.fromNombre, address: r.fromEmail },
      to: d.email,
      replyTo: r.replyTo || undefined,
      subject: asunto,
      text: aTexto(html),
      html,
      messageId: `<${randomUUID()}@${dominio}>`,
      headers: {
        // Baja en un clic (RFC 8058): exigida por Gmail, Yahoo y Outlook a remitentes masivos
        'List-Unsubscribe': `<${v.url_baja}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        // Gmail Postmaster Tools agrupa quejas por este identificador
        'Feedback-ID': `${(p.campanaId ?? 'prueba').slice(0, 8)}:${r.empresaId.slice(0, 8)}:marketing:nuvamail`,
        Precedence: 'bulk',
      },
    });
    return new Promise((ok, mal) => composer.compile().build((e, b) => (e ? mal(e) : ok(b))));
  }

  /** Envía por SES. Devuelve el MessageId de SES (o uno simulado). */
  async enviar(r: Remitente, d: Destinatario, p: Pieza): Promise<string> {
    const crudo = await this.construir(r, d, p);
    if (config.simulacion) return `sim-${randomUUID()}`;
    const etiqueta = (n: string, v: string) => ({ Name: n, Value: v.replace(/[^A-Za-z0-9_-]/g, '_') });
    const out = await this.ses.send(new SendEmailCommand({
      FromEmailAddress: r.fromEmail,
      Destination: { ToAddresses: [d.email] },
      Content: { Raw: { Data: crudo } },
      ConfigurationSetName: config.sesConfigSet || undefined,
      EmailTags: [
        etiqueta('empresa_id', r.empresaId), etiqueta('campana_id', p.campanaId ?? 'prueba'),
        etiqueta('contacto_id', String(d.id)), etiqueta('variante', p.variante ?? 'A'),
      ],
    }));
    return out.MessageId!;
  }

  esLimiteSes(e: any): boolean {
    return ['TooManyRequestsException', 'ThrottlingException', 'LimitExceededException'].includes(e?.name);
  }
  esCuentaPausada(e: any): boolean {
    return e?.name === 'SendingPausedException' || e?.name === 'AccountSuspendedException' ||
      (e?.name === 'MessageRejected' && /not verified/i.test(e?.message ?? ''));
  }
}
