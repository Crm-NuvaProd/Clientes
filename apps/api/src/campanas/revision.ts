import type { RevisionItem } from '@nuvamail/contratos';
import { aTexto } from '../plantillas/render.js';

const PALABRAS = ['gratis', '100% gratis', 'gane ', 'gana dinero', 'dinero fácil', 'urgente', 'actúe ahora', 'oferta exclusiva',
  'sin costo', 'haga clic aquí', 'clic aquí', 'click aquí', 'felicidades', 'ganador', 'premio', 'garantizado', 'sin riesgo',
  'última oportunidad', 'compre ya', '$$$', 'crédito aprobado', 'promoción limitada', 'no es spam', 'gánese'];
const ACORTADORES = ['bit.ly', 'tinyurl.com', 'goo.gl', 'ow.ly', 't.co/', 'is.gd', 'cutt.ly', 'rebrand.ly', 'shorturl.at'];

export interface DatosRevision {
  asunto: string; asuntoB?: string; preencabezado: string; html: string; dominioEnvio: string; fromEmail: string;
  destinatarios: number; topeDiario: number;
}

/** Revisión previa al envío: lo marcado como "error" bloquea el envío. */
export function revisar(d: DatosRevision): RevisionItem[] {
  const out: RevisionItem[] = [];
  const add = (nivel: RevisionItem['nivel'], mensaje: string) => out.push({ nivel, mensaje });
  const texto = aTexto(d.html);
  const todo = `${d.asunto} ${d.asuntoB ?? ''} ${texto}`.toLowerCase();

  if (!d.fromEmail) add('error', 'Configure el remitente (Configuración → Remitente) antes de enviar.');
  else if (d.dominioEnvio && !d.fromEmail.endsWith(`@${d.dominioEnvio}`)) add('error', `El remitente debe ser del dominio verificado ${d.dominioEnvio}.`);
  if (/gmail\.com|hotmail\.com|outlook\.com|yahoo\./i.test(d.fromEmail)) add('error', 'No envíe desde Gmail/Hotmail: DMARC de esos dominios hará que lo rechacen.');
  if (!d.html) add('error', 'La campaña no tiene contenido.');
  if (d.destinatarios === 0) add('error', 'No hay destinatarios activos en las listas elegidas.');

  for (const [cual, a] of [['Asunto', d.asunto], ['Asunto B', d.asuntoB ?? '']] as const) {
    if (cual === 'Asunto B' && !a) continue;
    if (!a.trim()) add('error', `${cual} vacío.`);
    if (a.length > 70) add('aviso', `${cual} largo (${a.length} caracteres). Ideal 30–60: en móvil se corta.`);
    const letras = [...a].filter((ch) => /\p{L}/u.test(ch));
    if (letras.length > 5 && letras.filter((ch) => ch === ch.toUpperCase()).length / letras.length > 0.5) add('aviso', `${cual} con demasiadas MAYÚSCULAS.`);
    if ((a.match(/!/g) ?? []).length > 1) add('aviso', `${cual}: evite varios signos de exclamación.`);
    if (/^(re|rv|fw|fwd):/i.test(a.trim())) add('error', `${cual}: no simule respuestas o reenvíos (RE:, RV:); es engañoso y lo penalizan.`);
  }
  const encontradas = PALABRAS.filter((p) => todo.includes(p));
  if (encontradas.length) add('aviso', `Palabras que activan filtros: ${encontradas.map((p) => p.trim()).join(', ')}.`);

  const enlaces = [...d.html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]).filter((u) => !u.includes('{{url_baja}}'));
  if (enlaces.length > 15) add('aviso', `${enlaces.length} enlaces: más de 15 aumenta el riesgo de spam.`);
  if (enlaces.some((u) => ACORTADORES.some((s) => u.includes(s)))) add('error', 'No use acortadores (bit.ly, etc.): están en listas negras.');
  if (enlaces.some((u) => /^http:\/\//i.test(u))) add('aviso', 'Hay enlaces sin HTTPS.');
  if (enlaces.some((u) => /^https?:\/\/\d+\.\d+\.\d+\.\d+/.test(u))) add('error', 'Hay enlaces a direcciones IP: típico de phishing.');
  if (/<(script|form|iframe|object|embed)\b/i.test(d.html)) add('error', 'El HTML tiene <script>, <form> o <iframe>.');

  const imgs = (d.html.match(/<img\b/gi) ?? []).length;
  if (imgs && texto.length < 400) add('aviso', 'Mucha imagen y poco texto. Un correo solo de imágenes suele ir a spam: use ~60 % texto.');
  if (/<img\b(?![^>]*\balt=)/i.test(d.html)) add('aviso', 'Hay imágenes sin texto alternativo (alt).');
  if (/src=["']data:/i.test(d.html)) add('error', 'Hay imágenes incrustadas en base64: súbalas a la biblioteca de imágenes.');
  const kb = Buffer.byteLength(d.html) / 1024;
  if (kb > 95) add('aviso', `HTML de ${kb.toFixed(0)} KB: Gmail lo recorta desde ~102 KB (y oculta el enlace de baja).`);
  if (!d.preencabezado) add('aviso', 'Sin preencabezado: el texto junto al asunto será lo primero del correo.');
  if (!/\{\{\s*(nombre|empresa)/.test(`${d.asunto} ${d.html}`)) add('aviso', 'Sin personalización ({{nombre}}, {{empresa}}).');
  if (!d.html.includes('{{url_baja}}')) add('error', 'Falta el enlace de baja.');
  if (d.destinatarios > d.topeDiario) add('aviso', `Hay ${d.destinatarios} destinatarios y el tope diario es ${d.topeDiario}: el envío tomará varios días (calentamiento).`);
  if (!out.length) add('ok', 'Sin problemas detectados.');
  return out;
}
