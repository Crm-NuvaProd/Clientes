import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Campana, Lista, PlantillaResumen, RevisionItem } from '@nuvamail/contratos';
import { Api, Avisos, num } from '../../core/api';

interface Revision { items: RevisionItem[]; destinatarios: number; excluidosInactivos: number; tope: number; dias: number; html: string }

@Component({
  selector: 'nm-campana-form',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="cabecera"><h1>{{ id() ? 'Editar campaña' : 'Nueva campaña' }}</h1><a class="btn fantasma" routerLink="/campanas">Volver</a></header>
    <ol class="pasos-campana">
      @for (p of pasos; track p; let i = $index) {
        <li [class.on]="paso() === i" [class.hecho]="paso() > i"><button (click)="irA(i)" [disabled]="i > 0 && !id()">{{ i + 1 }}. {{ p }}</button></li>
      }
    </ol>

    <form [formGroup]="form" class="tarjeta">
      @switch (paso()) {
        @case (0) {
          <h2>Destinatarios</h2>
          <label for="nombre">Nombre interno de la campaña</label>
          <input id="nombre" formControlName="nombre" placeholder="Ej. Lanzamiento MRP — noviembre">
          <label>Listas <span class="tenue">(sin seleccionar = todos los contactos activos)</span></label>
          <div class="checks">
            @for (l of listas(); track l.id) {
              <label class="check"><input type="checkbox" [checked]="form.value.lista_ids?.includes(l.id)" (change)="alternarLista(l.id)">
                {{ l.nombre }} <span class="tenue">({{ num(l.activos) }} activos)</span></label>
            } @empty { <p class="tenue">No hay listas; se enviará a todos los contactos activos.</p> }
          </div>
          <label for="inact">Política de inactividad <span class="tenue">(protege la reputación)</span></label>
          <select id="inact" formControlName="excluir_inactivos_dias">
            <option [ngValue]="0">Enviar a todos los activos</option>
            <option [ngValue]="90">Excluir a quien no interactúa hace 90 días (3+ envíos)</option>
            <option [ngValue]="180">Excluir a quien no interactúa hace 180 días (3+ envíos)</option>
            <option [ngValue]="365">Excluir a quien no interactúa hace 1 año (3+ envíos)</option>
          </select>
        }
        @case (1) {
          <h2>Contenido</h2>
          <label for="plantilla">Diseño del correo</label>
          <select id="plantilla" formControlName="plantilla_id">
            <option [ngValue]="null">— Elija un diseño —</option>
            @for (p of plantillas(); track p.id) { <option [ngValue]="p.id">{{ p.nombre }}{{ p.origen === 'claude' ? ' · Claude' : '' }}</option> }
          </select>
          <p class="tenue pequeno">¿No está? <a routerLink="/plantillas">Cree un diseño o importe una pieza de Claude</a>.</p>
          <label for="asunto">Asunto <span class="tenue">({{ form.value.asunto?.length ?? 0 }} caracteres; ideal 30–60)</span></label>
          <input id="asunto" formControlName="asunto" [placeholder]="ejemploAsunto">
          <label for="pre">Preencabezado</label>
          <input id="pre" formControlName="preencabezado" placeholder="Órdenes, inventario y costos reales conectados a Siigo">
          <fieldset class="ab">
            <legend>Prueba A/B del asunto</legend>
            <label for="abp">Porcentaje de la lista para la prueba</label>
            <select id="abp" formControlName="ab_porcentaje">
              <option [ngValue]="0">Sin prueba A/B</option><option [ngValue]="10">10 %</option><option [ngValue]="20">20 %</option><option [ngValue]="30">30 %</option>
            </select>
            @if (form.value.ab_porcentaje) {
              <label for="asb">Asunto B</label><input id="asb" formControlName="asunto_b">
              <div class="fila">
                <div><label for="abh">Elegir ganador después de</label>
                  <select id="abh" formControlName="ab_horas"><option [ngValue]="2">2 horas</option><option [ngValue]="4">4 horas</option><option [ngValue]="24">24 horas</option></select></div>
                <div><label for="abc">Gana por</label>
                  <select id="abc" formControlName="ab_criterio"><option value="aperturas">Aperturas reales</option><option value="clics">Clics</option></select></div>
              </div>
              <p class="tenue pequeno">La mitad de la muestra recibe el asunto A y la otra el B. El resto recibe el ganador.</p>
            }
          </fieldset>
        }
        @case (2) {
          <h2>Revisión y envío</h2>
          @if (rev(); as r) {
            <div class="kpis compactos">
              <div class="kpi"><small>Destinatarios</small><b>{{ num(r.destinatarios) }}</b></div>
              <div class="kpi"><small>Excluidos por inactividad</small><b>{{ num(r.excluidosInactivos) }}</b></div>
              <div class="kpi"><small>Tope diario hoy</small><b>{{ num(r.tope) }}</b></div>
              <div class="kpi"><small>Días estimados</small><b>{{ r.dias }}</b></div>
            </div>
            <h3>Revisión antispam</h3>
            <ul class="revision">
              @for (i of r.items; track i.mensaje) { <li><span class="pill" [class]="i.nivel">{{ {ok:'OK', aviso:'Atención', error:'Bloquea'}[i.nivel] }}</span> {{ i.mensaje }}</li> }
            </ul>
            <div class="dos-col">
              <div>
                <h3>Prueba</h3>
                <p class="tenue pequeno">Envíe a sus cuentas (Gmail, Outlook, corporativo). En Gmail abra "Mostrar original" y confirme SPF, DKIM y DMARC = PASS.</p>
                <div class="fila"><input #correos placeholder="yo@gmail.com, yo@nuvaprod.com" aria-label="Correos de prueba">
                  <button type="button" class="btn fantasma" (click)="probar(correos.value)">Enviar prueba</button></div>
                @for (x of prueba(); track x) { <p class="pequeno">{{ x }}</p> }
                <h3>Enviar</h3>
                <label for="cuando">Cuándo</label>
                <input id="cuando" type="datetime-local" #cuando aria-describedby="ayuda-cuando">
                <p id="ayuda-cuando" class="tenue pequeno">Vacío = ahora. Mejores horarios B2B: martes a jueves, 8–10 a. m.</p>
                <label for="conf">Escriba ENVIAR para confirmar</label>
                <div class="fila"><input id="conf" #conf>
                  <button type="button" class="btn" [disabled]="bloqueado()" (click)="enviar(conf.value, cuando.value)">Programar envío</button></div>
              </div>
              <iframe class="marco pequeno" sandbox="" [srcdoc]="vista()" title="Vista previa"></iframe>
            </div>
          } @else { <p class="tenue">Revisando…</p> }
        }
      }
      <div class="fila espacio pie-form">
        <button type="button" class="btn fantasma" [disabled]="paso() === 0" (click)="irA(paso() - 1)">Anterior</button>
        @if (paso() < 2) { <button type="button" class="btn" [disabled]="form.controls.nombre.invalid" (click)="siguiente()">Guardar y continuar</button> }
      </div>
    </form>`,
})
export class CampanaForm {
  readonly id = input<string>();
  private api = inject(Api);
  private avisos = inject(Avisos);
  private router = inject(Router);
  private ruta = inject(ActivatedRoute);
  private san = inject(DomSanitizer);
  private location = inject(Location);
  protected num = num;
  protected ejemploAsunto = '{{nombre}}, así planean la producción las pymes con Siigo';
  protected pasos = ['Destinatarios', 'Contenido', 'Revisión y envío'];
  protected paso = signal(0);
  protected listas = signal<Lista[]>([]);
  protected plantillas = signal<PlantillaResumen[]>([]);
  protected rev = signal<Revision | null>(null);
  protected vista = signal<SafeHtml>('');
  protected prueba = signal<string[]>([]);
  protected bloqueado = signal(true);
  private campanaId = '';

  protected form = inject(FormBuilder).group({
    nombre: ['', [Validators.required, Validators.maxLength(150)]],
    lista_ids: [[] as string[]],
    excluir_inactivos_dias: [180],
    plantilla_id: [null as string | null],
    asunto: ['', Validators.maxLength(150)],
    preencabezado: ['', Validators.maxLength(200)],
    asunto_b: ['', Validators.maxLength(150)],
    ab_porcentaje: [0],
    ab_horas: [4],
    ab_criterio: ['aperturas' as 'aperturas' | 'clics'],
  });

  constructor() {
    queueMicrotask(() => this.iniciar());
  }

  private async iniciar() {
    this.listas.set(await this.api.get('/contactos/listas/todas'));
    this.plantillas.set(await this.api.get('/plantillas'));
    const pl = this.ruta.snapshot.queryParamMap.get('plantilla');
    if (pl) this.form.patchValue({ plantilla_id: pl });
    if (this.id()) {
      this.campanaId = this.id()!;
      const c = await this.api.get<Campana>(`/campanas/${this.campanaId}`);
      if (c.estado !== 'borrador') { this.router.navigate(['/campanas', c.id, 'reporte']); return; }
      this.form.patchValue(c as any);
    }
  }

  alternarLista(id: string) {
    const s = new Set(this.form.value.lista_ids ?? []);
    s.has(id) ? s.delete(id) : s.add(id);
    this.form.patchValue({ lista_ids: [...s] });
  }

  private async guardar() {
    const v = this.form.getRawValue();
    const cuerpo = { ...v, asunto_b: v.ab_porcentaje ? v.asunto_b : '' };
    if (this.campanaId) await this.api.put(`/campanas/${this.campanaId}`, cuerpo);
    else {
      this.campanaId = (await this.api.post<{ id: string }>('/campanas', cuerpo)).id;
      this.location.replaceState(`/campanas/${this.campanaId}/editar`);
    }
  }

  async siguiente() {
    await this.guardar();
    this.irA(this.paso() + 1);
  }

  async irA(i: number) {
    if (i === 2 && this.paso() !== 2) await this.guardar();
    this.paso.set(i);
    if (i === 2) {
      this.rev.set(null);
      const r = await this.api.get<Revision>(`/campanas/${this.campanaId}/revision`);
      this.rev.set(r);
      this.bloqueado.set(r.items.some((x) => x.nivel === 'error'));
      this.vista.set(this.san.bypassSecurityTrustHtml(r.html.replace(/\{\{url_baja\}\}/g, '#')));
    }
  }

  async probar(texto: string) {
    const correos = texto.split(/[,;\s]+/).filter(Boolean).slice(0, 5);
    if (!correos.length) return;
    const r = await this.api.post<{ resultados: string[] }>(`/campanas/${this.campanaId}/prueba`, { correos });
    this.prueba.set(r.resultados);
  }

  async enviar(conf: string, cuando: string) {
    if (conf.trim().toUpperCase() !== 'ENVIAR') { this.avisos.mostrar('Escriba ENVIAR para confirmar', 'error'); return; }
    await this.api.post(`/campanas/${this.campanaId}/enviar`, {
      confirmacion: 'ENVIAR', ...(cuando ? { programada_para: new Date(cuando).toISOString() } : {}),
    });
    this.avisos.mostrar(cuando ? 'Campaña programada' : 'Envío iniciado');
    this.router.navigate(['/campanas', this.campanaId, 'reporte']);
  }
}
