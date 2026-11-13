import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Contacto, Lista, Pagina, ResultadoImportacion } from '@nuvamail/contratos';
import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { Api, Avisos, ESTADOS_CONTACTO, fecha, num, Sesion } from '../../core/api';

@Component({
  selector: 'nm-contactos',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="cabecera"><h1>Contactos <span class="tenue">({{ num(pagina()?.total) }})</span></h1>
      @if (sesion.puede('admin','editor')) { <button class="btn" (click)="importando.set(!importando())">Importar CSV</button> }
    </header>

    @if (importando()) {
      <section class="tarjeta">
        <h2>Importar contactos</h2>
        <p class="tenue">Columnas reconocidas: <b>email</b> (o correo), nombre, empresa, ciudad, cargo, origen_consentimiento, fecha_consentimiento.
          Acepta CSV con coma o punto y coma (Excel en español). Los contactos dados de baja, rebotados o con queja nunca se reactivan.</p>
        <div class="fila">
          <input type="file" accept=".csv,text/csv" (change)="archivo = $any($event.target).files?.[0] ?? null" aria-label="Archivo CSV">
          <select [(ngModel)]="listaImport" aria-label="Lista destino">
            <option value="">Sin lista</option>
            @for (l of listas(); track l.id) { <option [value]="l.id">{{ l.nombre }}</option> }
          </select>
          <input [(ngModel)]="origen" placeholder="Origen del consentimiento (ej. Clientes Siigo 2025)" aria-label="Origen">
        </div>
        <label class="check"><input type="checkbox" [(ngModel)]="verificarMx"> Verificar que cada dominio recibe correo (MX). Reduce rebotes.</label>
        <label class="check"><input type="checkbox" [(ngModel)]="autorizo"> Confirmo que estos contactos autorizaron recibir comunicaciones (Ley 1581 de 2012).</label>
        <button class="btn" [disabled]="!archivo || !autorizo || subiendo()" (click)="importar()">{{ subiendo() ? 'Validando…' : 'Importar' }}</button>
        @if (resultado(); as r) {
          <div class="kpis compactos">
            <div class="kpi"><small>Leídos</small><b>{{ num(r.leidos) }}</b></div>
            <div class="kpi"><small>Nuevos</small><b>{{ num(r.nuevos) }}</b></div>
            <div class="kpi"><small>Actualizados</small><b>{{ num(r.actualizados) }}</b></div>
            <div class="kpi"><small>Duplicados</small><b>{{ num(r.duplicados) }}</b></div>
            <div class="kpi alerta"><small>Descartados</small><b>{{ num(r.invalidos) }}</b></div>
            <div class="kpi"><small>Buzones genéricos</small><b>{{ num(r.genericos) }}</b></div>
          </div>
          @if (r.suprimidosRespetados) { <p class="tenue">{{ r.suprimidosRespetados }} ya estaban suprimidos y se mantuvieron así.</p> }
          @if (r.descartados.length) {
            <details><summary>Ver descartados</summary><table>@for (d of r.descartados; track d.email) {<tr><td>{{ d.email }}</td><td class="tenue">{{ d.motivo }}</td></tr>}</table></details>
          }
        }
      </section>
    }

    <div class="dos-col">
      <section class="tarjeta">
        <div class="fila">
          <input type="search" [(ngModel)]="q" (keyup.enter)="cargar(1)" placeholder="Buscar correo, nombre o empresa" aria-label="Buscar">
          <select [(ngModel)]="estado" (change)="cargar(1)" aria-label="Estado">
            <option value="">Todos los estados</option>
            @for (e of estadosLista; track e[0]) { <option [value]="e[0]">{{ e[1] }}</option> }
          </select>
          <select [(ngModel)]="segmento" (change)="cargar(1)" aria-label="Segmento">
            <option value="">Todos</option><option value="comprometidos">Interactuaron en 90 días</option>
            <option value="inactivos90">Inactivos (3+ envíos sin interacción)</option><option value="nunca">Nunca recibieron</option>
          </select>
          <select [(ngModel)]="lista" (change)="cargar(1)" aria-label="Lista">
            <option value="">Todas las listas</option>
            @for (l of listas(); track l.id) { <option [value]="l.id">{{ l.nombre }}</option> }
          </select>
        </div>
        <table>
          <thead><tr><th>Correo</th><th>Nombre</th><th>Empresa</th><th>Estado</th><th class="der">Env.</th><th class="der">Aper.</th><th class="der">Clics</th><th>Última interacción</th><th></th></tr></thead>
          <tbody>
            @for (c of pagina()?.data; track c.id) {
              <tr><td>{{ c.email }}</td><td>{{ c.nombre }}</td><td>{{ c.compania }}</td>
                <td><span class="pill" [class]="c.estado" [title]="c.estado_motivo">{{ estados[c.estado] }}</span></td>
                <td class="der">{{ c.envios }}</td><td class="der">{{ c.aperturas }}</td><td class="der">{{ c.clics }}</td>
                <td class="tenue">{{ fecha(c.ultima_interaccion) }}</td>
                <td class="acciones">
                  @if (c.estado === 'activo' && sesion.puede('admin','editor')) { <button class="btn fantasma pequeno" (click)="baja(c)">Dar de baja</button> }
                  @if (sesion.puede('admin')) { <button class="btn fantasma pequeno peligro" (click)="suprimir(c)" title="Derecho de supresión (Ley 1581)">Suprimir datos</button> }
                </td></tr>
            } @empty { <tr><td colspan="9" class="tenue">Sin contactos con esos filtros.</td></tr> }
          </tbody>
        </table>
        @if (pagina(); as p) {
          <div class="paginador">
            <button class="btn fantasma pequeno" [disabled]="p.page <= 1" (click)="cargar(p.page - 1)">Anterior</button>
            <span>Página {{ p.page }} de {{ Math.max(1, Math.ceil(p.total / p.pageSize)) }}</span>
            <button class="btn fantasma pequeno" [disabled]="p.page * p.pageSize >= p.total" (click)="cargar(p.page + 1)">Siguiente</button>
          </div>
        }
      </section>
      <section class="tarjeta lateral-der">
        <h2>Listas</h2>
        @for (l of listas(); track l.id) {
          <div class="lista-item"><b>{{ l.nombre }}</b><span class="tenue">{{ num(l.activos) }} activos de {{ num(l.contactos) }}</span></div>
        } @empty { <p class="tenue">Sin listas.</p> }
        @if (sesion.puede('admin','editor')) {
          <div class="fila"><input [(ngModel)]="nuevaLista" placeholder="Nueva lista" aria-label="Nombre de la nueva lista">
            <button class="btn pequeno" [disabled]="!nuevaLista" (click)="crearLista()">Crear</button></div>
        }
      </section>
    </div>`,
})
export class ContactosPagina {
  private api = inject(Api);
  private http = inject(HttpClient);
  private avisos = inject(Avisos);
  protected sesion = inject(Sesion);
  protected Math = Math;
  protected num = num; protected fecha = fecha; protected estados = ESTADOS_CONTACTO;
  protected estadosLista = Object.entries(ESTADOS_CONTACTO);
  protected pagina = signal<Pagina<Contacto> | null>(null);
  protected listas = signal<Lista[]>([]);
  protected importando = signal(false);
  protected subiendo = signal(false);
  protected resultado = signal<ResultadoImportacion | null>(null);
  q = ''; estado = ''; segmento = ''; lista = '';
  archivo: File | null = null; listaImport = ''; origen = ''; verificarMx = true; autorizo = false; nuevaLista = '';

  constructor() {
    this.cargar(1);
    this.cargarListas();
  }

  async cargar(page: number) {
    this.pagina.set(await this.api.get<Pagina<Contacto>>('/contactos', {
      q: this.q, estado: this.estado, segmento: this.segmento, lista: this.lista, page, pageSize: 50,
    }));
  }
  async cargarListas() {
    this.listas.set(await this.api.get<Lista[]>('/contactos/listas/todas'));
  }
  async importar() {
    if (!this.archivo) return;
    const f = new FormData();
    f.append('archivo', this.archivo);
    f.append('confirmo_autorizacion', 'true');
    f.append('verificar_mx', String(this.verificarMx));
    if (this.listaImport) f.append('lista_id', this.listaImport);
    if (this.origen) f.append('origen', this.origen);
    this.subiendo.set(true);
    try {
      this.resultado.set(await firstValueFrom(this.http.post<ResultadoImportacion>(this.api.url('/contactos/importar'), f)));
      this.avisos.mostrar('Importación terminada');
      this.cargar(1);
      this.cargarListas();
    } finally {
      this.subiendo.set(false);
    }
  }
  async baja(c: Contacto) {
    await this.api.post(`/contactos/${c.id}/baja`);
    this.cargar(this.pagina()?.page ?? 1);
  }
  async suprimir(c: Contacto) {
    if (!confirm(`¿Suprimir definitivamente los datos de ${c.email}? Solo quedará una huella para no volver a escribirle.`)) return;
    await this.api.delete(`/contactos/${c.id}`);
    this.avisos.mostrar('Datos suprimidos');
    this.cargar(this.pagina()?.page ?? 1);
  }
  async crearLista() {
    await this.api.post('/contactos/listas', { nombre: this.nuevaLista });
    this.nuevaLista = '';
    this.cargarListas();
  }
}
