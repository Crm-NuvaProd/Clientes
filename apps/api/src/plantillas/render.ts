import type { AjustesCorreo, Bloque, DisenoCorreo } from '@nuvamail/contratos';
import mjml2html from 'mjml';
import sanitizeHtml from 'sanitize-html';

// ---------- Saneamiento ----------
/** Texto enriquecido de los bloques del editor. */
export function limpiarTexto(html: string): string {
  return sanitizeHtml(html ?? '', {
    allowedTags: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'span', 'h1', 'h2', 'h3', 'div'],
    allowedAttributes: { a: ['href', 'title', 'style'], span: ['style'], p: ['style'], div: ['style'], h1: ['style'], h2: ['style'], h3: ['style'] },
    allowedSchemes: ['https', 'http', 'mailto', 'tel'],
    allowedStyles: { '*': { color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(/], 'text-align': [/^(left|right|center|justify)$/],
      'font-weight': [/^\w+$/], 'font-size': [/^\d{1,2}px$/], 'text-decoration': [/^\w+$/] } },
  });
}

/** HTML completo de correo (piezas de Claude o HTML pegado): conserva tablas y estilos, quita lo peligroso. */
export function limpiarCorreo(html: string): string {
  return sanitizeHtml(html ?? '', {
    allowedTags: false as unknown as string[],          // todas las etiquetas…
    disallowedTagsMode: 'discard',
    exclusiveFilter: (f) => ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select',
      'link', 'meta', 'base', 'frame', 'frameset', 'applet', 'svg'].includes(f.tag),
    allowedAttributes: false as unknown as Record<string, string[]>,
    allowedSchemes: ['https', 'http', 'mailto', 'tel', 'data', 'cid'],
    allowedSchemesByTag: { img: ['https', 'http', 'data', 'cid'] },
    allowVulnerableTags: true,                           // <style> es necesario en correos
    transformTags: {
      '*': (tag, attribs) => {
        for (const k of Object.keys(attribs)) if (/^on/i.test(k) || /javascript:/i.test(attribs[k])) delete attribs[k];
        return { tagName: tag, attribs };
      },
    },
  });
}

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const urlSegura = (u?: string) => (u && /^(https?:|mailto:|tel:|\{\{)/i.test(u.trim()) ? u.trim() : '');
const color = (c: string | undefined, d: string) => (c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : d);
const num = (n: unknown, min: number, max: number, d: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
};

export const AJUSTES_DEFECTO: AjustesCorreo = {
  fondo: '#f4f6fa', fondoContenido: '#ffffff', ancho: 600, fuente: 'Poppins, Arial, Helvetica, sans-serif',
  colorTexto: '#1f2937', colorEnlace: '#00B4D8',
};

const ICONOS: Record<string, string> = {
  facebook: 'facebook', instagram: 'instagram', linkedin: 'linkedin', youtube: 'youtube', x: 'x', whatsapp: 'whatsapp', web: 'web',
};

function bloqueMjml(b: Bloque, a: AjustesCorreo): string {
  const pad = `${num(b.padding, 0, 80, 20)}px 24px`;
  const bg = b.fondo ? ` background-color="${color(b.fondo, '')}"` : '';
  const seccion = (cuerpo: string, extra = '') => `<mj-section${bg} padding="0"${extra}><mj-column>${cuerpo}</mj-column></mj-section>`;
  switch (b.tipo) {
    case 'encabezado': {
      const logo = urlSegura(b.logoUrl)
        ? `<mj-image src="${esc(b.logoUrl!)}" alt="${esc(b.texto || 'Logo')}" height="${num(b.altoLogo, 20, 120, 48)}px" width="auto" align="${b.alineacion ?? 'left'}" padding="${pad}" />`
        : `<mj-text align="${b.alineacion ?? 'left'}" color="${color(b.color, '#ffffff')}" font-size="22px" font-weight="700" padding="${pad}">${esc(b.texto || '')}</mj-text>`;
      return `<mj-section background-color="${color(b.fondo, '#0A2342')}" padding="0"><mj-column>${logo}</mj-column></mj-section>`;
    }
    case 'texto':
      return seccion(`<mj-text align="${b.alineacion ?? 'left'}" color="${color(b.color, a.colorTexto)}" font-size="${num(b.tamano, 11, 40, 15)}px" line-height="1.6" padding="${pad}">${limpiarTexto(b.html)}</mj-text>`);
    case 'imagen': {
      if (!urlSegura(b.src) && !b.src?.startsWith('/')) return '';
      const href = urlSegura(b.enlace) ? ` href="${esc(b.enlace!)}"` : '';
      const ancho = Math.round((num(b.ancho, 10, 100, 100) / 100) * (a.ancho - 48));
      return seccion(`<mj-image src="${esc(b.src)}" alt="${esc(b.alt)}"${href} width="${ancho}px" align="${b.alineacion ?? 'center'}" padding="${pad}" />`);
    }
    case 'boton':
      if (!urlSegura(b.url)) return '';
      return seccion(`<mj-button href="${esc(b.url)}" background-color="${color(b.colorFondo, '#00B4D8')}" color="${color(b.color, '#ffffff')}" border-radius="${num(b.radio, 0, 40, 8)}px" font-weight="600" font-size="15px" inner-padding="14px 28px" align="${b.alineacion ?? 'center'}" padding="${pad}">${esc(b.texto)}</mj-button>`);
    case 'columnas': {
      const href = urlSegura(b.imagen?.enlace) ? ` href="${esc(b.imagen.enlace!)}"` : '';
      const img = urlSegura(b.imagen?.src) ? `<mj-column><mj-image src="${esc(b.imagen.src)}" alt="${esc(b.imagen.alt)}"${href} padding="${pad}" /></mj-column>` : '<mj-column></mj-column>';
      const txt = `<mj-column vertical-align="middle"><mj-text color="${a.colorTexto}" font-size="15px" line-height="1.6" padding="${pad}">${limpiarTexto(b.html)}</mj-text></mj-column>`;
      return `<mj-section${bg} padding="0"${b.invertir ? ' direction="rtl"' : ''}>${img}${txt}</mj-section>`;
    }
    case 'divisor':
      return seccion(`<mj-divider border-color="${color(b.color, '#e5e7eb')}" border-width="${num(b.grosor, 1, 8, 1)}px" padding="${pad}" />`);
    case 'espaciador':
      return seccion(`<mj-spacer height="${num(b.alto, 4, 120, 24)}px" />`);
    case 'redes': {
      const els = (b.enlaces ?? []).filter((e) => urlSegura(e.url) && ICONOS[e.red])
        .map((e) => `<mj-social-element name="${ICONOS[e.red]}-noshare" href="${esc(e.url)}"></mj-social-element>`).join('');
      return els ? seccion(`<mj-social font-size="0px" icon-size="28px" mode="horizontal" padding="${pad}">${els}</mj-social>`) : '';
    }
    case 'html':
      // mj-raw dentro de una columna queda dentro de <tbody>: se envuelve en fila/celda con tamaño de letra propio
      return seccion(`<mj-raw><tr><td style="padding:${pad};font-family:${esc(a.fuente)};font-size:15px;line-height:1.6;color:${a.colorTexto}">${limpiarCorreo(b.html)}</td></tr></mj-raw>`);
    default:
      return '';
  }
}

export interface Pie { texto: string; urlPolitica: string; direccion: string }

/** Diseño → HTML de correo responsive (MJML). El pie legal y la baja se agregan aquí, siempre. */
export async function renderizar(d: DisenoCorreo, preencabezado = '', pie?: Pie): Promise<{ html: string; avisos: string[] }> {
  const a = { ...AJUSTES_DEFECTO, ...(d.ajustes ?? {}) };
  a.ancho = num(a.ancho, 480, 700, 600);
  const cuerpo = (d.bloques ?? []).map((b) => bloqueMjml(b, a)).join('\n');
  const pieMjml = pie
    ? `<mj-section padding="0"><mj-column><mj-text align="center" color="#6b7280" font-size="12px" line-height="1.6" padding="20px 24px">
        ${esc(pie.texto)}${pie.direccion ? `<br>${esc(pie.direccion)}` : ''}<br>
        ${pie.urlPolitica ? `<a href="${esc(pie.urlPolitica)}" style="color:#6b7280">Política de datos</a> · ` : ''}
        <a href="{{url_baja}}" style="color:#6b7280">Cancelar suscripción</a></mj-text></mj-column></mj-section>`
    : '';
  const mjml = `<mjml lang="es"><mj-head>
      <mj-title>${esc(preencabezado)}</mj-title>
      ${preencabezado ? `<mj-preview>${esc(preencabezado)}</mj-preview>` : ''}
      <mj-attributes><mj-all font-family="${esc(a.fuente)}" /><mj-text padding="0" /></mj-attributes>
      <mj-style>a { color: ${color(a.colorEnlace, '#00B4D8')}; } p { margin: 0 0 12px; }</mj-style>
    </mj-head>
    <mj-body background-color="${color(a.fondo, '#f4f6fa')}" width="${a.ancho}px">
      <mj-wrapper background-color="${color(a.fondoContenido, '#ffffff')}" padding="0" border-radius="10px">${cuerpo}</mj-wrapper>
      ${pieMjml}
    </mj-body></mjml>`;
  const r = await mjml2html(mjml, { validationLevel: 'soft', minify: false });
  return { html: r.html, avisos: (r.errors ?? []).map((e: any) => e.formattedMessage ?? e.message) };
}

/** HTML importado (de Claude u otra herramienta) + pie legal obligatorio. */
export function agregarPie(html: string, pie: Pie): string {
  const bloque = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"
    style="padding:20px 24px;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#6b7280">
    ${esc(pie.texto)}${pie.direccion ? `<br>${esc(pie.direccion)}` : ''}<br>
    ${pie.urlPolitica ? `<a href="${esc(pie.urlPolitica)}" style="color:#6b7280">Política de datos</a> · ` : ''}
    <a href="{{url_baja}}" style="color:#6b7280">Cancelar suscripción</a></td></tr></table>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${bloque}</body>`) : html + bloque;
}

// ---------- Personalización (sin motor de plantillas: no hay ejecución de código) ----------
export type Variables = Record<'nombre' | 'nombre_completo' | 'empresa' | 'ciudad' | 'cargo' | 'email' | 'url_baja', string>;

export function personalizar(texto: string, v: Variables, esHtml: boolean): string {
  return texto.replace(/\{\{\s*([a-z_]+)(?:\s*\|\s*"([^"]*)")?\s*\}\}/g, (m, k: string, defecto?: string) => {
    if (!Object.prototype.hasOwnProperty.call(v, k)) return m;
    const valor = v[k as keyof Variables] || defecto || '';
    return esHtml && k !== 'url_baja' ? esc(valor) : valor;
  });
}

export function aTexto(html: string): string {
  return html
    .replace(/<(style|head|title)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, h, t) => `${t.replace(/<[^>]+>/g, '')} (${h})`)
    .replace(/<(br|\/p|\/div|\/h\d|\/tr|\/li)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}
