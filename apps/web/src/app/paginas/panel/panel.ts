import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Panel } from '@nuvamail/contratos';
import { Grafico } from '../../comun/grafico';
import { Api, ESTADOS_CAMPANA, fecha, num, pct } from '../../core/api';

@Component({
  selector: 'nm-panel',
  imports: [RouterLink, Grafico],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="cabecera"><h1>Panel</h1><a class="btn" routerLink="/campanas/nueva">Nueva campaña</a></header>
    @if (p(); as p) {
      <div class="salud" [class]="p.salud.nivel">
        <b>{{ {bien:'Reputación sana', regular:'Atención', mal:'Riesgo de entregabilidad'}[p.salud.nivel] }}</b>
        @for (m of p.salud.mensajes; track m) { <span>{{ m }}</span> }
      </div>
      <section class="kpis">
        <div class="kpi"><small>Contactos activos</small><b>{{ num(p.contactos.activo) }}</b><span class="tenue">{{ num(p.contactos.baja) }} bajas · {{ num(p.contactos.rebote) }} rebotados · {{ num(p.contactos.queja) }} quejas</span></div>
        <div class="kpi"><small>Enviados hoy / tope</small><b>{{ num(p.enviadosHoy) }} / {{ num(p.topeHoy) }}</b>
          <span class="tenue">{{ p.diaCalentamiento ? 'Día ' + p.diaCalentamiento + ' de calentamiento' : 'Sin plan de calentamiento' }}</span></div>
        <div class="kpi"><small>Entrega (30 días)</small><b>{{ pct(p.ultimos30.tasaEntrega) }}</b><span class="tenue">{{ num(p.ultimos30.enviados) }} enviados</span></div>
        <div class="kpi"><small>Apertura real (30 días)</small><b>{{ pct(p.ultimos30.tasaApertura) }}</b><span class="tenue">sin aperturas automáticas de Apple</span></div>
        <div class="kpi"><small>Clics (30 días)</small><b>{{ pct(p.ultimos30.tasaClic) }}</b></div>
        <div class="kpi" [class.alerta]="p.ultimos30.tasaQueja > 0.001"><small>Quejas (30 días)</small><b>{{ pct(p.ultimos30.tasaQueja, 2) }}</b><span class="tenue">límite sano 0,10 %</span></div>
      </section>
      <section class="tarjeta">
        <h2>Tendencia por campaña</h2>
        @if (p.tendencia.length) { <nm-grafico [opciones]="tendencia()" [alto]="280" etiqueta="Apertura y clics por campaña" /> }
        @else { <p class="tenue">Cuando envíe campañas verá aquí cómo evolucionan aperturas, clics y rebotes.</p> }
      </section>
    }
    <section class="tarjeta">
      <h2>Últimas campañas</h2>
      <table>
        <thead><tr><th>Campaña</th><th>Estado</th><th class="der">Enviados</th><th class="der">Aperturas</th><th class="der">Clics</th><th>Fecha</th></tr></thead>
        <tbody>
          @for (c of campanas(); track c.id) {
            <tr><td><a [routerLink]="c.estado === 'borrador' ? ['/campanas', c.id, 'editar'] : ['/campanas', c.id, 'reporte']">{{ c.nombre }}</a></td>
              <td><span class="pill" [class]="c.estado">{{ estados[c.estado] }}</span></td>
              <td class="der">{{ num(c.enviados) }}</td><td class="der">{{ num(c.aperturas) }}</td><td class="der">{{ num(c.clics) }}</td>
              <td class="tenue">{{ fecha(c.iniciada || c.creado) }}</td></tr>
          } @empty { <tr><td colspan="6" class="tenue">Aún no hay campañas.</td></tr> }
        </tbody>
      </table>
    </section>`,
})
export class PanelPagina {
  private api = inject(Api);
  protected p = signal<Panel | null>(null);
  protected campanas = signal<any[]>([]);
  protected estados = ESTADOS_CAMPANA;
  protected num = num; protected pct = pct; protected fecha = fecha;

  protected tendencia = computed(() => {
    const t = this.p()?.tendencia ?? [];
    return {
      legend: { bottom: 0 },
      grid: { left: 48, right: 16, top: 16, bottom: 48 },
      xAxis: { type: 'category', data: t.map((x) => x.campana), axisLabel: { width: 110, overflow: 'truncate' } },
      yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${Math.round(v * 100)} %` } },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => pct(v) },
      series: [
        { name: 'Apertura real', type: 'line', smooth: true, data: t.map((x) => x.apertura) },
        { name: 'Clics', type: 'line', smooth: true, data: t.map((x) => x.clic) },
        { name: 'Rebote duro', type: 'bar', data: t.map((x) => x.rebote), itemStyle: { color: '#E76F51' } },
      ],
    };
  });

  constructor() {
    this.api.get<Panel>('/estadisticas/panel').then((p) => this.p.set(p));
    this.api.get<any[]>('/campanas').then((c) => this.campanas.set(c.slice(0, 8)));
  }
}
