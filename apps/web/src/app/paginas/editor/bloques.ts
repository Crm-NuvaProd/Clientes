import type { Bloque, DisenoCorreo, TipoBloque } from '@nuvamail/contratos';

export const id = () => Math.random().toString(36).slice(2, 10);

export const PALETA: { tipo: TipoBloque; nombre: string; ico: string; ayuda: string }[] = [
  { tipo: 'encabezado', nombre: 'Encabezado', ico: '▀', ayuda: 'Logo o nombre sobre una franja de color' },
  { tipo: 'texto', nombre: 'Texto', ico: '¶', ayuda: 'Párrafos con negrita, enlaces y variables' },
  { tipo: 'imagen', nombre: 'Imagen', ico: '▣', ayuda: 'Imagen con texto alternativo y enlace' },
  { tipo: 'boton', nombre: 'Botón', ico: '⬭', ayuda: 'Llamado a la acción' },
  { tipo: 'columnas', nombre: 'Imagen + texto', ico: '◧', ayuda: 'Dos columnas (se apilan en móvil)' },
  { tipo: 'divisor', nombre: 'Divisor', ico: '―', ayuda: 'Línea separadora' },
  { tipo: 'espaciador', nombre: 'Espacio', ico: '↕', ayuda: 'Espacio en blanco' },
  { tipo: 'redes', nombre: 'Redes', ico: '◎', ayuda: 'Íconos de redes sociales' },
  { tipo: 'html', nombre: 'HTML', ico: '</>', ayuda: 'Código HTML libre' },
];

export function nuevoBloque(tipo: TipoBloque): Bloque {
  const b = { id: id() };
  switch (tipo) {
    case 'encabezado': return { ...b, tipo, texto: 'NuvaProd', fondo: '#0A2342', color: '#ffffff', alineacion: 'left', altoLogo: 44 };
    case 'texto': return { ...b, tipo, html: '<p>Hola {{nombre}},</p><p>Escriba aquí su mensaje.</p>', alineacion: 'left', tamano: 15 };
    case 'imagen': return { ...b, tipo, src: '', alt: '', ancho: 100, alineacion: 'center' };
    case 'boton': return { ...b, tipo, texto: 'Agendar demostración', url: 'https://', colorFondo: '#00B4D8', color: '#ffffff', alineacion: 'center', radio: 8 };
    case 'columnas': return { ...b, tipo, imagen: { src: '', alt: '' }, html: '<p><b>Título</b><br>Describa el beneficio en una o dos líneas.</p>' };
    case 'divisor': return { ...b, tipo, color: '#e5e7eb', grosor: 1 };
    case 'espaciador': return { ...b, tipo, alto: 24 };
    case 'redes': return { ...b, tipo, enlaces: [{ red: 'linkedin', url: 'https://www.linkedin.com/company/' }, { red: 'instagram', url: 'https://instagram.com/' }] };
    case 'html': return { ...b, tipo, html: '<p style="text-align:center">HTML personalizado</p>' };
  }
}

export const DISENO_INICIAL = (): DisenoCorreo => ({
  formato: 'nuvamail/1',
  ajustes: { fondo: '#f4f6fa', fondoContenido: '#ffffff', ancho: 600, fuente: 'Poppins, Arial, Helvetica, sans-serif', colorTexto: '#1f2937', colorEnlace: '#00B4D8' },
  bloques: [nuevoBloque('encabezado'), nuevoBloque('texto'), nuevoBloque('boton')],
});

export const VARIABLES = [
  { v: '{{nombre}}', t: 'Nombre' }, { v: '{{empresa}}', t: 'Empresa' }, { v: '{{ciudad}}', t: 'Ciudad' },
  { v: '{{cargo}}', t: 'Cargo' }, { v: '{{empresa|"su empresa"}}', t: 'Empresa o texto por defecto' },
];

/** Instrucción que el usuario pega en Claude para que la pieza llegue lista para importar y editar. */
export const INSTRUCCION_CLAUDE = `Diseña una pieza de correo de marketing para NuvaMail y entrégamela SOLO como un bloque de código JSON con este formato exacto ("nuvamail/1"):

{
  "formato": "nuvamail/1",
  "ajustes": { "fondo": "#f4f6fa", "fondoContenido": "#ffffff", "ancho": 600, "fuente": "Poppins, Arial, sans-serif", "colorTexto": "#1f2937", "colorEnlace": "#00B4D8" },
  "bloques": [ ...bloques en orden... ]
}

Tipos de bloque permitidos (campo "tipo") y sus campos:
- "encabezado": texto, logoUrl (https, opcional), fondo, color, alineacion ("left"|"center"|"right")
- "texto": html (solo <p> <b> <i> <u> <a href> <br> <ul> <ol> <li> <h2> <h3>), alineacion, tamano (14–18), color
- "imagen": src (URL https pública o data:image/png;base64), alt (obligatorio, descriptivo), enlace (opcional), ancho (% de 10 a 100)
- "boton": texto, url (https), colorFondo, color, alineacion, radio
- "columnas": imagen { src, alt, enlace }, html (texto de la columna derecha), invertir (true/false)
- "divisor": color, grosor
- "espaciador": alto (px)
- "redes": enlaces [{ "red": "linkedin"|"instagram"|"facebook"|"youtube"|"x"|"whatsapp"|"web", "url": "https://..." }]

Reglas para que no caiga en spam:
- Colores de marca NuvaProd: azul marino #0A2342, cian #00B4D8, amarillo #FFC313.
- Al menos 60 % texto frente a imágenes; toda imagen con "alt".
- Un solo llamado a la acción principal (botón) y máximo 6 enlaces.
- Personaliza con {{nombre}} y {{empresa}} (o {{empresa|"su empresa"}}).
- Nada de MAYÚSCULAS sostenidas, signos !!!, ni palabras como "gratis", "urgente", "gane".
- No incluyas pie legal ni enlace de baja: NuvaMail los agrega solo.
- Propón también 2 asuntos (30–55 caracteres) y un preencabezado, fuera del JSON.

Contenido de la pieza: `;
