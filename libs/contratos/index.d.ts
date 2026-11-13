// Contratos compartidos entre la API (NestJS) y la web (Angular). Solo tipos: se borran al compilar.

// ---------- Diseño de correo (formato del editor y de las piezas de Claude) ----------
export interface AjustesCorreo {
  fondo: string;            // color de fondo exterior
  fondoContenido: string;   // color de la caja de 600 px
  ancho: number;            // 480–700, recomendado 600
  fuente: string;           // 'Poppins, Arial, sans-serif'
  colorTexto: string;
  colorEnlace: string;
}

interface Base { id: string; fondo?: string; padding?: number }

export interface BloqueEncabezado extends Base { tipo: 'encabezado'; logoUrl?: string; texto?: string; color?: string; alineacion?: Alineacion; altoLogo?: number }
export interface BloqueTexto extends Base { tipo: 'texto'; html: string; alineacion?: Alineacion; tamano?: number; color?: string }
export interface BloqueImagen extends Base { tipo: 'imagen'; src: string; alt: string; enlace?: string; ancho?: number; alineacion?: Alineacion }
export interface BloqueBoton extends Base { tipo: 'boton'; texto: string; url: string; colorFondo?: string; color?: string; alineacion?: Alineacion; radio?: number }
export interface BloqueColumnas extends Base { tipo: 'columnas'; imagen: { src: string; alt: string; enlace?: string }; html: string; invertir?: boolean }
export interface BloqueDivisor extends Base { tipo: 'divisor'; color?: string; grosor?: number }
export interface BloqueEspaciador extends Base { tipo: 'espaciador'; alto: number }
export interface BloqueRedes extends Base { tipo: 'redes'; enlaces: { red: 'facebook' | 'instagram' | 'linkedin' | 'youtube' | 'x' | 'whatsapp' | 'web'; url: string }[] }
export interface BloqueHtml extends Base { tipo: 'html'; html: string }

export type Alineacion = 'left' | 'center' | 'right';
export type Bloque = BloqueEncabezado | BloqueTexto | BloqueImagen | BloqueBoton | BloqueColumnas
  | BloqueDivisor | BloqueEspaciador | BloqueRedes | BloqueHtml;
export type TipoBloque = Bloque['tipo'];

export interface DisenoCorreo { formato: 'nuvamail/1'; ajustes: AjustesCorreo; bloques: Bloque[] }

// ---------- Paginación ----------
export interface Pagina<T> { data: T[]; total: number; page: number; pageSize: number }

// ---------- Contactos ----------
export type EstadoContacto = 'activo' | 'baja' | 'rebote' | 'queja' | 'invalido';
export interface Contacto {
  id: number; email: string; nombre: string; compania: string; ciudad: string; cargo: string;
  estado: EstadoContacto; estado_motivo: string; origen_consentimiento: string;
  envios: number; aperturas: number; clics: number; ultima_interaccion: string | null; creado: string;
}
export interface Lista { id: string; nombre: string; descripcion: string; contactos: number; activos: number }
export interface ResultadoImportacion {
  leidos: number; nuevos: number; actualizados: number; duplicados: number; invalidos: number;
  genericos: number; suprimidosRespetados: number; descartados: { email: string; motivo: string }[];
}

// ---------- Plantillas ----------
export interface PlantillaResumen { id: string; nombre: string; origen: 'editor' | 'claude' | 'html'; actualizado: string }
export interface Plantilla extends PlantillaResumen { diseno: DisenoCorreo; html: string }

// ---------- Campañas ----------
export type EstadoCampana = 'borrador' | 'programada' | 'prueba_ab' | 'enviando' | 'pausada' | 'terminada';
export interface Campana {
  id: string; nombre: string; asunto: string; asunto_b: string; ab_porcentaje: number; ab_horas: number;
  ab_criterio: 'aperturas' | 'clics'; ab_ganador: 'A' | 'B' | null; preencabezado: string;
  plantilla_id: string | null; lista_ids: string[]; excluir_inactivos_dias: number; estado: EstadoCampana;
  motivo_pausa: string; programada_para: string | null; iniciada: string | null; terminada: string | null; creado: string;
}
export interface RevisionItem { nivel: 'ok' | 'aviso' | 'error'; mensaje: string }

// ---------- Estadísticas ----------
export interface Kpis {
  destinatarios: number; enviados: number; enCola: number; omitidos: number; fallidos: number;
  entregados: number; rebotesDuros: number; rebotesSuaves: number; rechazados: number; quejas: number; bajas: number;
  aperturasUnicas: number; aperturasTotales: number; aperturasMpp: number; clicsUnicos: number; clicsTotales: number;
  tasaEntrega: number; tasaRebote: number; tasaApertura: number; tasaAperturaSinMpp: number; tasaClic: number;
  ctor: number; tasaBaja: number; tasaQueja: number;
}
export interface Veredicto {
  puntaje: number;  // 0–100
  nivel: 'exitosa' | 'aceptable' | 'por_mejorar' | 'problema_entregabilidad';
  titulo: string;
  indicadores: { nombre: string; valor: number; referencia: string; estado: 'bien' | 'regular' | 'mal' }[];
  recomendaciones: string[];
}
export interface ReporteCampana {
  campana: Campana;
  kpis: Kpis;
  veredicto: Veredicto;
  comparacion: { promedioApertura: number; promedioClic: number; campanasComparadas: number };
  lineaTiempo: { hora: string; aperturas: number; clics: number }[];
  porDominio: { dominio: string; enviados: number; entregados: number; rebotes: number; aperturas: number; clics: number }[];
  porDispositivo: { dispositivo: string; aperturas: number }[];
  porCliente: { cliente: string; aperturas: number }[];
  enlaces: { url: string; clicsUnicos: number; clicsTotales: number }[];
  motivosRebote: { motivo: string; tipo: 'duro' | 'suave'; cantidad: number }[];
  ab: { variante: 'A' | 'B'; asunto: string; enviados: number; aperturas: number; clics: number }[] | null;
}
export interface Panel {
  contactos: Record<EstadoContacto, number>;
  enviadosHoy: number; topeHoy: number; diaCalentamiento: number | null;
  ultimos30: { enviados: number; tasaEntrega: number; tasaApertura: number; tasaClic: number; tasaQueja: number; tasaRebote: number };
  tendencia: { campana: string; fecha: string; apertura: number; clic: number; rebote: number }[];
  salud: { nivel: 'bien' | 'regular' | 'mal'; mensajes: string[] };
}
export interface ChequeoDns { registro: string; nombre: string; estado: 'ok' | 'falta' | 'revisar'; valor: string; esperado: string }
