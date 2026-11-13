import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { PlantillaResumen } from '@nuvamail/contratos';
import { Api, Avisos, fecha, Sesion } from '../../core/api';
import { DISENO_INICIAL, INSTRUCCION_CLAUDE } from '../editor/bloques';

@Component({
  selector: 'nm-plantillas',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="cabecera"><h1>Diseños de correo</h1>
      @if (sesion.puede('admin','editor')) {
        <div class="fila">
          <button class="btn fantasma" (click)="importando.set(!importando())">Importar pieza de Claude</button>
          <button class="btn" (click)="nuevo()">Nuevo diseño</button>
        </div>
      }
    </header>

    @if (importando()) {
      <section class="tarjeta">
        <h2>Importar una pieza diseñada por Claude</h2>
        <ol class="pasos">
          <li>Copie la instrucción de abajo y péguela en Claude junto con lo que quiere comunicar (ej. "lanzamiento del módulo MRP para pymes de alimentos").</li>
          <li>Claude responde con un bloque JSON <code>nuvamail/1</code>. Péguelo aquí o suba el archivo. Quedará <b>editable bloque por bloque</b>.</li>
          <li>También puede pegar o subir el <b>HTML</b> de una pieza de Claude: se importa tal cual como un bloque HTML.</li>
        </ol>
        <details><summary>Ver la instrucción para Claude</summary><pre class="codigo">{{ instruccion }}</pre></details>
        <button class="btn fantasma pequeno" (click)="copiar()">Copiar instrucción para Claude</button>
        <label for="nombre-imp">Nombre del diseño</label>
        <input id="nombre-imp" [(ngModel)]="nombre" placeholder="Ej. Lanzamiento MRP — noviembre">
        <label for="contenido-imp">Pegue aquí el JSON o el HTML de Claude</label>
        <textarea id="contenido-imp" rows="10" [(ngModel)]="contenido" class="mono"></textarea>
        <div class="fila">
          <input type="file" accept=".json,.html,.htm,.md,.txt" (change)="leerArchivo($event)" aria-label="Archivo de la pieza">
          <button class="btn" [disabled]="!nombre || !contenido || cargando()" (click)="importar()">{{ cargando() ? 'Importando…' : 'Importar' }}</button>
        </div>
      </section>
    }

    <section class="rejilla">
      @for (p of plantillas(); track p.id) {
        <article class="tarjeta plantilla">
          <span class="pill" [class]="p.origen">{{ origen[p.origen] }}</span>
          <h3><a [routerLink]="['/plantillas', p.id]">{{ p.nombre }}</a></h3>
          <p class="tenue">Editado {{ fecha(p.actualizado) }}</p>
          <div class="fila">
            <a class="btn pequeno" [routerLink]="['/plantillas', p.id]">Abrir</a>
            @if (sesion.puede('admin','editor')) {
              <button class="btn fantasma pequeno" (click)="duplicar(p)">Duplicar</button>
              <button class="btn fantasma pequeno peligro" (click)="borrar(p)">Borrar</button>
            }
          </div>
        </article>
      } @empty { <p class="tenue">Aún no hay diseños. Cree uno nuevo o importe una pieza de Claude.</p> }
    </section>`,
})
export class PlantillasPagina {
  private api = inject(Api);
  private router = inject(Router);
  private avisos = inject(Avisos);
  protected sesion = inject(Sesion);
  protected fecha = fecha;
  protected instruccion = INSTRUCCION_CLAUDE;
  protected origen: Record<string, string> = { editor: 'Editor', claude: 'Pieza de Claude', html: 'HTML importado' };
  protected plantillas = signal<PlantillaResumen[]>([]);
  protected importando = signal(false);
  protected cargando = signal(false);
  nombre = ''; contenido = '';

  constructor() { this.cargar(); }

  async cargar() { this.plantillas.set(await this.api.get<PlantillaResumen[]>('/plantillas')); }

  async nuevo() {
    const p = await this.api.post<PlantillaResumen>('/plantillas', { nombre: 'Diseño sin título', diseno: DISENO_INICIAL() });
    this.router.navigate(['/plantillas', p.id]);
  }
  async copiar() {
    await navigator.clipboard.writeText(this.instruccion);
    this.avisos.mostrar('Instrucción copiada. Péguela en Claude.');
  }
  async leerArchivo(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (f.size > 3_000_000) { this.avisos.mostrar('Archivo de más de 3 MB', 'error'); return; }
    this.contenido = await f.text();
    if (!this.nombre) this.nombre = f.name.replace(/\.[^.]+$/, '');
  }
  async importar() {
    this.cargando.set(true);
    try {
      const r = await this.api.post<any>('/plantillas/importar', { nombre: this.nombre, formato: 'auto', contenido: this.contenido });
      this.avisos.mostrar(r.editable ? `Importado: ${r.bloques} bloques editables${r.imagenesSubidas ? `, ${r.imagenesSubidas} imágenes subidas` : ''}` : 'HTML importado');
      this.router.navigate(['/plantillas', r.id]);
    } finally {
      this.cargando.set(false);
    }
  }
  async duplicar(p: PlantillaResumen) { await this.api.post(`/plantillas/${p.id}/duplicar`); this.cargar(); }
  async borrar(p: PlantillaResumen) {
    if (!confirm(`¿Borrar "${p.nombre}"? (No se borran diseños usados por campañas)`)) return;
    await this.api.delete(`/plantillas/${p.id}`);
    this.cargar();
  }
}
