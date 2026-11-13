import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDragPlaceholder, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, HostListener, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import type { AjustesCorreo, Bloque, DisenoCorreo, Plantilla, TipoBloque } from '@nuvamail/contratos';
import { firstValueFrom } from 'rxjs';
import { Api, Avisos, Sesion } from '../../core/api';
import { id, nuevoBloque, PALETA, VARIABLES } from './bloques';

type Campo = { k: string; t: string; tipo: 'texto' | 'url' | 'color' | 'numero' | 'alinear' | 'imagen' | 'area' | 'check'; min?: number; max?: number };

const CAMPOS: Record<TipoBloque, Campo[]> = {
  encabezado: [{ k: 'texto', t: 'Texto (si no hay logo)', tipo: 'texto' }, { k: 'logoUrl', t: 'Logo', tipo: 'imagen' },
    { k: 'altoLogo', t: 'Alto del logo (px)', tipo: 'numero', min: 20, max: 120 }, { k: 'fondo', t: 'Fondo', tipo: 'color' },
    { k: 'color', t: 'Color del texto', tipo: 'color' }, { k: 'alineacion', t: 'Alineación', tipo: 'alinear' }],
  texto: [{ k: 'tamano', t: 'Tamaño (px)', tipo: 'numero', min: 12, max: 28 }, { k: 'color', t: 'Color', tipo: 'color' },
    { k: 'alineacion', t: 'Alineación', tipo: 'alinear' }, { k: 'fondo', t: 'Fondo', tipo: 'color' }],
  imagen: [{ k: 'src', t: 'Imagen', tipo: 'imagen' }, { k: 'alt', t: 'Texto alternativo (obligatorio)', tipo: 'texto' },
    { k: 'enlace', t: 'Enlace al hacer clic', tipo: 'url' }, { k: 'ancho', t: 'Ancho (%)', tipo: 'numero', min: 10, max: 100 },
    { k: 'alineacion', t: 'Alineación', tipo: 'alinear' }],
  boton: [{ k: 'texto', t: 'Texto del botón', tipo: 'texto' }, { k: 'url', t: 'Enlace', tipo: 'url' },
    { k: 'colorFondo', t: 'Color del botón', tipo: 'color' }, { k: 'color', t: 'Color del texto', tipo: 'color' },
    { k: 'radio', t: 'Redondeo (px)', tipo: 'numero', min: 0, max: 40 }, { k: 'alineacion', t: 'Alineación', tipo: 'alinear' }],
  columnas: [{ k: 'imagen.src', t: 'Imagen', tipo: 'imagen' }, { k: 'imagen.alt', t: 'Texto alternativo', tipo: 'texto' },
    { k: 'imagen.enlace', t: 'Enlace de la imagen', tipo: 'url' }, { k: 'invertir', t: 'Imagen a la derecha', tipo: 'check' }],
  divisor: [{ k: 'color', t: 'Color', tipo: 'color' }, { k: 'grosor', t: 'Grosor (px)', tipo: 'numero', min: 1, max: 8 }],
  espaciador: [{ k: 'alto', t: 'Alto (px)', tipo: 'numero', min: 4, max: 120 }],
  redes: [],
  html: [{ k: 'html', t: 'Código HTML', tipo: 'area' }],
};

@Component({
  selector: 'nm-editor',
  imports: [FormsModule, RouterLink, CdkDropList, CdkDrag, CdkDragHandle, CdkDragPlaceholder],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './editor.html',
})
export class Editor {
  readonly id = input.required<string>();
  private api = inject(Api);
  private http = inject(HttpClient);
  private avisos = inject(Avisos);
  private router = inject(Router);
  private san = inject(DomSanitizer);
  protected sesion = inject(Sesion);
  protected paleta = PALETA;
  protected variables = VARIABLES;
  protected alineaciones = [{ v: 'left', t: 'Izq.' }, { v: 'center', t: 'Centro' }, { v: 'right', t: 'Der.' }];
  protected redes = ['linkedin', 'instagram', 'facebook', 'youtube', 'x', 'whatsapp', 'web'];

  protected nombre = signal('');
  protected origen = signal('editor');
  protected diseno = signal<DisenoCorreo | null>(null);
  protected seleccion = signal<string | null>(null);
  protected modo = signal<'editar' | 'vista'>('editar');
  protected dispositivo = signal<'escritorio' | 'movil'>('escritorio');
  protected vista = signal<SafeHtml | null>(null);
  protected kb = signal(0);
  protected sucio = signal(false);
  protected guardando = signal(false);
  protected biblioteca = signal<{ id: string; nombre: string; url: string }[] | null>(null);
  private destinoBiblioteca = '';
  private historial: string[] = [];
  protected preencabezado = '';

  protected bloqueSel = computed(() => this.diseno()?.bloques.find((b) => b.id === this.seleccion()) ?? null);
  protected campos = computed(() => { const b = this.bloqueSel(); return b ? CAMPOS[b.tipo] : []; });
  protected nombreTipo = (t: TipoBloque) => PALETA.find((p) => p.tipo === t)?.nombre ?? t;

  constructor() {
    queueMicrotask(() => this.cargar());
  }

  private async cargar() {
    const p = await this.api.get<Plantilla>(`/plantillas/${this.id()}`);
    this.nombre.set(p.nombre);
    this.origen.set(p.origen);
    this.diseno.set(p.diseno);
    this.seleccion.set(p.diseno.bloques[0]?.id ?? null);
  }

  // ---------- Edición ----------
  private cambiar(fn: (d: DisenoCorreo) => void) {
    const d = this.diseno();
    if (!d) return;
    this.historial.push(JSON.stringify(d));
    if (this.historial.length > 50) this.historial.shift();
    const copia: DisenoCorreo = structuredClone(d);
    fn(copia);
    this.diseno.set(copia);
    this.sucio.set(true);
  }
  protected deshacer() {
    const prev = this.historial.pop();
    if (prev) { this.diseno.set(JSON.parse(prev)); this.sucio.set(true); }
  }
  protected agregar(tipo: TipoBloque, indice?: number) {
    const b = nuevoBloque(tipo);
    this.cambiar((d) => {
      const i = indice ?? (this.seleccion() ? d.bloques.findIndex((x) => x.id === this.seleccion()) + 1 : d.bloques.length);
      d.bloques.splice(i, 0, b);
    });
    this.seleccion.set(b.id);
  }
  protected soltar(ev: CdkDragDrop<any>) {
    if (ev.previousContainer === ev.container) {
      if (ev.previousIndex !== ev.currentIndex) this.cambiar((d) => moveItemInArray(d.bloques, ev.previousIndex, ev.currentIndex));
    } else {
      this.agregar(ev.item.data as TipoBloque, ev.currentIndex);
    }
  }
  protected mover(b: Bloque, delta: number) {
    this.cambiar((d) => {
      const i = d.bloques.findIndex((x) => x.id === b.id);
      const j = i + delta;
      if (j >= 0 && j < d.bloques.length) moveItemInArray(d.bloques, i, j);
    });
  }
  protected duplicar(b: Bloque) {
    const c = { ...structuredClone(b), id: id() };
    this.cambiar((d) => d.bloques.splice(d.bloques.findIndex((x) => x.id === b.id) + 1, 0, c));
    this.seleccion.set(c.id);
  }
  protected eliminar(b: Bloque) {
    this.cambiar((d) => (d.bloques = d.bloques.filter((x) => x.id !== b.id)));
    this.seleccion.set(null);
  }
  protected valor(b: Bloque, ruta: string): any {
    return ruta.split('.').reduce((o: any, k) => o?.[k], b);
  }
  protected fijar(ruta: string, v: unknown) {
    const sel = this.seleccion();
    this.cambiar((d) => {
      const b: any = d.bloques.find((x) => x.id === sel);
      const partes = ruta.split('.');
      let o = b;
      for (const k of partes.slice(0, -1)) o = o[k] ??= {};
      o[partes.at(-1)!] = v;
    });
  }
  protected ajuste<K extends keyof AjustesCorreo>(k: K, v: AjustesCorreo[K]) {
    this.cambiar((d) => (d.ajustes[k] = v));
  }
  /** El texto se edita directamente en el lienzo; se guarda al salir del campo. */
  protected textoEditado(b: Bloque, el: HTMLElement) {
    const html = el.innerHTML;
    if ((b as any).html === html) return;
    const sel = b.id;
    this.cambiar((d) => { const x: any = d.bloques.find((y) => y.id === sel); x.html = html; });
  }
  protected formato(cmd: 'bold' | 'italic' | 'underline' | 'insertUnorderedList' | 'link' | 'variable', valor?: string) {
    if (cmd === 'link') {
      const url = prompt('Dirección del enlace (https://…)', 'https://');
      if (url && /^(https?:|mailto:|tel:)/.test(url)) document.execCommand('createLink', false, url);
      return;
    }
    if (cmd === 'variable') { document.execCommand('insertText', false, valor ?? ''); return; }
    document.execCommand(cmd);
  }
  protected redFijar(i: number, campo: 'red' | 'url', v: string) {
    const sel = this.seleccion();
    this.cambiar((d) => { const b: any = d.bloques.find((x) => x.id === sel); b.enlaces[i][campo] = v; });
  }
  protected redAgregar() {
    const sel = this.seleccion();
    this.cambiar((d) => { const b: any = d.bloques.find((x) => x.id === sel); b.enlaces.push({ red: 'web', url: 'https://' }); });
  }
  protected redQuitar(i: number) {
    const sel = this.seleccion();
    this.cambiar((d) => { const b: any = d.bloques.find((x) => x.id === sel); b.enlaces.splice(i, 1); });
  }
  protected seguro(html: string): SafeHtml {
    // Solo se usa dentro de un iframe con sandbox sin scripts
    return this.san.bypassSecurityTrustHtml(html);
  }

  // ---------- Imágenes ----------
  protected async subir(ev: Event, ruta: string) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('archivo', f);
    const a = await firstValueFrom(this.http.post<{ url: string; nombre: string }>(this.api.url('/activos'), fd));
    this.fijar(ruta, a.url);
    const b = this.bloqueSel() as any;
    if (b?.tipo === 'imagen' && !b.alt) this.fijar('alt', a.nombre.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
    this.avisos.mostrar('Imagen subida');
  }
  protected async abrirBiblioteca(ruta: string) {
    this.destinoBiblioteca = ruta;
    this.biblioteca.set(await this.api.get('/activos'));
  }
  protected elegir(url: string) {
    this.fijar(this.destinoBiblioteca, url);
    this.biblioteca.set(null);
  }

  // ---------- Vista previa y guardado ----------
  protected async verVista() {
    this.modo.set('vista');
    const r = await this.api.post<{ html: string; kb: number; avisoTamano: string }>('/plantillas/vista-previa', {
      diseno: this.diseno(), preencabezado: this.preencabezado,
    });
    const muestra = r.html.replace(/\{\{\s*nombre\s*\}\}/g, 'Ana María').replace(/\{\{\s*empresa(\s*\|\s*"[^"]*")?\s*\}\}/g, 'Alimentos del Valle')
      .replace(/\{\{\s*ciudad\s*\}\}/g, 'Cali').replace(/\{\{\s*cargo\s*\}\}/g, 'Gerente').replace(/\{\{url_baja\}\}/g, '#');
    this.vista.set(this.seguro(muestra));
    this.kb.set(r.kb);
    if (r.avisoTamano) this.avisos.mostrar(r.avisoTamano, 'info');
  }
  protected async guardar() {
    if (!this.diseno()) return;
    this.guardando.set(true);
    try {
      await this.api.put(`/plantillas/${this.id()}`, { nombre: this.nombre(), diseno: this.diseno() });
      this.sucio.set(false);
      this.avisos.mostrar('Diseño guardado');
    } finally {
      this.guardando.set(false);
    }
  }
  protected async usarEnCampana() {
    if (this.sucio()) await this.guardar();
    this.router.navigate(['/campanas/nueva'], { queryParams: { plantilla: this.id() } });
  }

  @HostListener('document:keydown', ['$event'])
  atajos(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.guardar(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target as HTMLElement)?.isContentEditable
      && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) { e.preventDefault(); this.deshacer(); }
  }
}
