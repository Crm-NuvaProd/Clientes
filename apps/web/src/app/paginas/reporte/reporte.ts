import { ChangeDetectionStrategy, Component, computed, inject, input, OnDestroy, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ReporteCampana } from '@nuvamail/contratos';
import { Grafico } from '../../comun/grafico';
import { Api, Avisos, ESTADOS_CAMPANA, fecha, num, pct, Sesion } from '../../core/api';

type Pestana = 'resumen' | 'entregabilidad' | 'aperturas' | 'clics' | 'ab';

@Component({
  selector: 'nm-reporte',
  imports: [RouterLink, Grafico],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reporte.html',
})
export class Reporte implements OnDestroy {
  readonly id = input.required<string>();
  private api = inject(Api);
  private avisos = inject(Avisos);
  protected sesion = inject(Sesion);
  protected r = signal<ReporteCampana | null>(null);
  protected pestana = signal<Pestana>('resumen');
  protected estados = ESTADOS_CAMPANA;
  protected num = num; protected pct = pct; protected fecha = fecha;
  private t = setInterval(() => { if (['enviando', 'prueba_ab', 'programada'].includes(this.r()?.campana.estado ?? '')) this.cargar(); }, 8000);

  constructor() { queueMicrotask(() => this.cargar()); }
  ngOnDestroy() { clearInterval(this.t); }

  async cargar() { this.r.set(await this.api.get<ReporteCampana>(`/estadisticas/campanas/${this.id()}`)); }

  protected progreso = computed(() => {
    const k = this.r()?.kpis;
    return k && k.destinatarios ? k.enviados / k.destinatarios : 0;
  });

  protected embudo = computed(() => {
    const k = this.r()?.kpis;
    if (!k) return {};
    const datos = [
      { name: 'Enviados', value: k.enviados }, { name: 'Entregados', value: k.entregados },
      { name: 'Abrieron (reales)', value: k.aperturasUnicas - k.aperturasMpp }, { name: 'Hicieron clic', value: k.clicsUnicos },
    ];
    return {
      tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}: ${num(p.value)}` },
      series: [{ type: 'funnel', left: 10, right: 10, top: 10, bottom: 10, minSize: '38%', sort: 'none', gap: 3,
        label: { position: 'inside', formatter: (p: any) => `${p.name}: ${num(p.value)}`, color: '#fff', fontWeight: 600, textBorderWidth: 0 }, labelLine: { show: false }, data: datos }],
    };
  });

  protected lineaTiempo = computed(() => {
    const t = this.r()?.lineaTiempo ?? [];
    return {
      legend: { bottom: 0 }, grid: { left: 40, right: 16, top: 16, bottom: 56 },
      xAxis: { type: 'category', data: t.map((x) => x.hora.slice(5).replace(' ', ' · ')) },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        { name: 'Aperturas reales', type: 'line', smooth: true, areaStyle: { opacity: 0.15 }, data: t.map((x) => x.aperturas) },
        { name: 'Clics', type: 'line', smooth: true, data: t.map((x) => x.clics) },
      ],
    };
  });

  protected dona = (datos: { nombre: string; valor: number }[]) => ({
    tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}: ${num(p.value)} (${p.percent} %)` },
    legend: { bottom: 0, type: 'scroll' },
    series: [{ type: 'pie', radius: ['45%', '72%'], center: ['50%', '45%'], label: { show: false }, data: datos.map((d) => ({ name: d.nombre, value: d.valor })) }],
  });
  protected dispositivos = computed(() => this.dona((this.r()?.porDispositivo ?? []).map((d) => ({ nombre: d.dispositivo, valor: d.aperturas }))));
  protected clientes = computed(() => this.dona((this.r()?.porCliente ?? []).map((d) => ({ nombre: d.cliente, valor: d.aperturas }))));

  protected dominios = computed(() => {
    const d = this.r()?.porDominio ?? [];
    return {
      legend: { bottom: 0 }, grid: { left: 110, right: 16, top: 10, bottom: 40 },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => pct(v) },
      yAxis: { type: 'category', data: d.map((x) => x.dominio), inverse: true },
      xAxis: { type: 'value', max: 1, axisLabel: { formatter: (v: number) => `${Math.round(v * 100)} %` } },
      series: [
        { name: 'Entrega', type: 'bar', data: d.map((x) => (x.enviados ? x.entregados / x.enviados : 0)) },
        { name: 'Apertura', type: 'bar', data: d.map((x) => (x.entregados ? x.aperturas / x.entregados : 0)) },
      ],
    };
  });

  protected async accion(a: 'pausar' | 'reanudar') {
    await this.api.post(`/campanas/${this.id()}/${a}`);
    this.avisos.mostrar(a === 'pausar' ? 'Campaña pausada' : 'Envío reanudado');
    this.cargar();
  }
  protected exportar() { window.location.href = this.api.url(`/estadisticas/campanas/${this.id()}/csv`); }
  protected corto(u: string) { return u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70); }
}
