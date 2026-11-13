import { ChangeDetectionStrategy, Component, effect, ElementRef, input, OnDestroy, viewChild } from '@angular/core';
import { BarChart, FunnelChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, BarChart, PieChart, FunnelChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

/** Paleta de marca NuvaProd para todos los gráficos. */
export const COLORES = ['#00B4D8', '#0A2342', '#FFC313', '#5B8DEF', '#2EC4B6', '#E76F51', '#8D99AE'];

@Component({
  selector: 'nm-grafico',
  template: `<div #lienzo class="grafico" [style.height.px]="alto()" role="img" [attr.aria-label]="etiqueta()"></div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Grafico implements OnDestroy {
  readonly opciones = input.required<echarts.EChartsCoreOption>();
  readonly alto = input(260);
  readonly etiqueta = input('Gráfico');
  private lienzo = viewChild.required<ElementRef<HTMLDivElement>>('lienzo');
  private grafico?: echarts.ECharts;
  private obs?: ResizeObserver;

  constructor() {
    effect(() => {
      const el = this.lienzo().nativeElement;
      if (!this.grafico) {
        this.grafico = echarts.init(el, undefined, { renderer: 'canvas' });
        this.obs = new ResizeObserver(() => this.grafico?.resize());
        this.obs.observe(el);
      }
      this.grafico.setOption({
        color: COLORES,
        textStyle: { fontFamily: 'Poppins, Arial, sans-serif' },
        tooltip: { trigger: 'axis' },
        ...this.opciones(),
      }, true);
    });
  }

  ngOnDestroy() {
    this.obs?.disconnect();
    this.grafico?.dispose();
  }
}
