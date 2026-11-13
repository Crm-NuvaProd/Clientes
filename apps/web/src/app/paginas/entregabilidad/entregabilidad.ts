import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ChequeoDns } from '@nuvamail/contratos';
import { Grafico } from '../../comun/grafico';
import { Api, num } from '../../core/api';

interface Estado { dominio: string; chequeos: ChequeoDns[]; enviadosHoy: number; topeHoy: number; diaCalentamiento: number | null; plan: number[]; estrategias: string[] }

@Component({
  selector: 'nm-entregabilidad',
  imports: [RouterLink, Grafico],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="cabecera"><h1>Entregabilidad</h1><button class="btn fantasma" (click)="cargar()">Volver a verificar</button></header>
    @if (e(); as e) {
      @if (!e.dominio) { <div class="salud regular"><b>Falta el dominio de envío.</b> <a routerLink="/configuracion">Configúrelo aquí</a>.</div> }
      <section class="tarjeta">
        <h2>Autenticación del dominio {{ e.dominio }}</h2>
        <p class="tenue">Gmail, Yahoo y Outlook rechazan los envíos masivos sin SPF, DKIM y DMARC alineados con el remitente.</p>
        <table>
          <thead><tr><th>Registro</th><th>Nombre DNS</th><th>Estado</th><th>Valor actual</th><th>Valor esperado</th></tr></thead>
          <tbody>@for (c of e.chequeos; track c.registro) {
            <tr><td><b>{{ c.registro }}</b></td><td class="mono pequeno">{{ c.nombre }}</td>
              <td><span class="pill" [class]="c.estado === 'ok' ? 'bien' : c.estado === 'falta' ? 'mal' : 'regular'">{{ {ok:'Correcto', falta:'Falta', revisar:'Revisar'}[c.estado] }}</span></td>
              <td class="mono pequeno">{{ c.valor || '—' }}</td><td class="mono pequeno tenue">{{ c.esperado }}</td></tr>
          }</tbody>
        </table>
      </section>
      <div class="dos-col">
        <section class="tarjeta">
          <h2>Calentamiento del dominio</h2>
          <p>{{ e.diaCalentamiento ? 'Día ' + e.diaCalentamiento + ' del plan.' : 'Sin fecha de inicio: se usa el tope diario fijo.' }}
            Hoy: <b>{{ num(e.enviadosHoy) }}</b> de <b>{{ num(e.topeHoy) }}</b>.</p>
          <nm-grafico [opciones]="plan()" [alto]="220" etiqueta="Plan de calentamiento" />
          <a routerLink="/configuracion" class="pequeno">Cambiar el plan</a>
        </section>
        <section class="tarjeta">
          <h2>Estrategias activas para reducir rechazos</h2>
          <ul class="estrategias">@for (x of e.estrategias; track x) { <li>✓ {{ x }}</li> }</ul>
        </section>
      </div>
    } @else { <p class="tenue">Consultando DNS…</p> }`,
})
export class EntregabilidadPagina {
  private api = inject(Api);
  protected e = signal<Estado | null>(null);
  protected num = num;
  protected plan = computed(() => {
    const e = this.e();
    const p = e?.plan ?? [];
    return {
      grid: { left: 56, right: 16, top: 16, bottom: 30 },
      xAxis: { type: 'category', data: p.map((_, i) => `Día ${i + 1}${i === p.length - 1 ? '+' : ''}`) },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: p.map((v, i) => ({ value: v, itemStyle: { color: e?.diaCalentamiento === i + 1 ? '#FFC313' : '#00B4D8' } })) }],
    };
  });
  constructor() { this.cargar(); }
  async cargar() { this.e.set(null); this.e.set(await this.api.get<Estado>('/empresa/entregabilidad')); }
}
