import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Api, Avisos, Sesion } from '../../core/api';

@Component({
  selector: 'nm-configuracion',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="cabecera"><h1>Configuración</h1></header>
    <form class="tarjeta" [formGroup]="form" (ngSubmit)="guardar()">
      <fieldset [disabled]="!sesion.puede('admin')">
      <h2>Remitente</h2>
      <div class="rejilla-form">
        <div><label for="nombre">Empresa</label><input id="nombre" formControlName="nombre"></div>
        <div><label for="dominio">Dominio de envío verificado en SES</label><input id="dominio" formControlName="dominio_envio" placeholder="mail.nuvaprod.com"></div>
        <div><label for="from">Correo remitente</label><input id="from" formControlName="from_email" placeholder="mauricio@mail.nuvaprod.com"></div>
        <div><label for="fromn">Nombre del remitente</label><input id="fromn" formControlName="from_nombre" placeholder="Mauricio de NuvaProd"></div>
        <div><label for="reply">Responder a (buzón real)</label><input id="reply" formControlName="reply_to"></div>
      </div>
      <p class="tenue pequeno">Un nombre de persona ("Mauricio de NuvaProd") abre más que "NuvaProd" o "noreply".</p>
      <h2>Pie legal (Ley 1581)</h2>
      <div class="rejilla-form">
        <div class="ancho"><label for="pie">Texto del pie</label><input id="pie" formControlName="pie_legal"></div>
        <div><label for="dir">Dirección física</label><input id="dir" formControlName="direccion" placeholder="Calle …, Cali, Colombia"></div>
        <div><label for="pol">URL de la política de datos (https)</label><input id="pol" formControlName="url_politica"></div>
      </div>
      <h2>Ritmo y calentamiento</h2>
      <div class="rejilla-form">
        <div><label for="wi">Inicio del calentamiento</label><input id="wi" type="date" formControlName="warmup_inicio"></div>
        <div><label for="wp">Plan diario (separado por comas)</label><input id="wp" formControlName="plan"></div>
        <div><label for="td">Tope diario absoluto (cuota SES)</label><input id="td" type="number" formControlName="tope_diario"></div>
        <div><label for="rs">Correos por segundo</label><input id="rs" type="number" step="0.5" formControlName="ritmo_seg"></div>
        <div><label for="tdm">Máx. por minuto a un mismo dominio</label><input id="tdm" type="number" formControlName="tope_dominio_min"></div>
      </div>
      <p class="tenue pequeno">El ritmo debe ser menor o igual al "Maximum send rate" de su cuenta SES. El tope por dominio evita que los servidores corporativos de sus clientes lo frenen.</p>
      <button class="btn" [disabled]="form.invalid">Guardar</button>
      </fieldset>
    </form>`,
})
export class ConfiguracionPagina {
  private api = inject(Api);
  private avisos = inject(Avisos);
  protected sesion = inject(Sesion);
  protected form = inject(FormBuilder).nonNullable.group({
    nombre: ['', Validators.required], dominio_envio: ['', Validators.required], from_email: ['', [Validators.required, Validators.email]],
    from_nombre: ['', Validators.required], reply_to: ['', [Validators.required, Validators.email]], pie_legal: ['', Validators.required],
    direccion: [''], url_politica: [''], warmup_inicio: [''], plan: ['500,1000,2000,3500,5000,7500,10000'],
    tope_diario: [10000], ritmo_seg: [8], tope_dominio_min: [60],
  });

  constructor() {
    this.api.get<any>('/empresa').then((e) => this.form.patchValue({
      ...e, warmup_inicio: e.warmup_inicio ? String(e.warmup_inicio).slice(0, 10) : '', plan: (e.warmup_plan ?? []).join(','),
    }));
  }

  async guardar() {
    const { plan, ...v } = this.form.getRawValue();
    await this.api.put('/empresa', {
      ...v, warmup_inicio: v.warmup_inicio || null, tope_diario: +v.tope_diario, ritmo_seg: +v.ritmo_seg, tope_dominio_min: +v.tope_dominio_min,
      warmup_plan: plan.split(/[,;\s]+/).map(Number).filter((n) => n > 0),
    });
    this.avisos.mostrar('Configuración guardada');
  }
}
