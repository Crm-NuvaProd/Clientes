import { ChangeDetectionStrategy, Component, inject, OnDestroy, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, ESTADOS_CAMPANA, fecha, num, pct, Sesion } from '../../core/api';

@Component({
  selector: 'nm-campanas',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="cabecera"><h1>Campañas</h1>
      @if (sesion.puede('admin','editor')) { <a class="btn" routerLink="/campanas/nueva">Nueva campaña</a> }
    </header>
    <section class="tarjeta">
      <table>
        <thead><tr><th>Campaña</th><th>Estado</th><th class="der">Enviados</th><th class="der">En cola</th><th class="der">Apertura real</th><th class="der">Clics</th><th>Inicio</th><th></th></tr></thead>
        <tbody>
          @for (c of lista(); track c.id) {
            <tr>
              <td><a [routerLink]="destino(c)">{{ c.nombre }}</a><br><span class="tenue pequeno">{{ c.asunto }}</span></td>
              <td><span class="pill" [class]="c.estado">{{ estados[c.estado] }}</span></td>
              <td class="der">{{ num(c.enviados) }}</td><td class="der">{{ num(c.en_cola) }}</td>
              <td class="der">{{ c.enviados ? pct(c.aperturas / c.enviados) : '—' }}</td>
              <td class="der">{{ c.enviados ? pct(c.clics / c.enviados) : '—' }}</td>
              <td class="tenue">{{ fecha(c.iniciada || c.programada_para) }}</td>
              <td class="acciones">
                @if (c.estado !== 'borrador') { <a class="btn fantasma pequeno" [routerLink]="['/campanas', c.id, 'reporte']">Reporte</a> }
                @if (sesion.puede('admin','editor')) { <button class="btn fantasma pequeno" (click)="duplicar(c.id)">Duplicar</button> }
              </td>
            </tr>
          } @empty { <tr><td colspan="8" class="tenue">Aún no hay campañas.</td></tr> }
        </tbody>
      </table>
    </section>`,
})
export class CampanasPagina implements OnDestroy {
  private api = inject(Api);
  private router = inject(Router);
  protected sesion = inject(Sesion);
  protected estados = ESTADOS_CAMPANA;
  protected num = num; protected pct = pct; protected fecha = fecha;
  protected lista = signal<any[]>([]);
  private t = setInterval(() => this.cargar(), 10_000);

  constructor() { this.cargar(); }
  ngOnDestroy() { clearInterval(this.t); }
  async cargar() { this.lista.set(await this.api.get<any[]>('/campanas')); }
  destino(c: any) { return c.estado === 'borrador' ? ['/campanas', c.id, 'editar'] : ['/campanas', c.id, 'reporte']; }
  async duplicar(id: string) {
    const r = await this.api.post<{ id: string }>(`/campanas/${id}/duplicar`);
    this.router.navigate(['/campanas', r.id, 'editar']);
  }
}
