import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Avisos, Sesion } from '../core/api';

@Component({
  selector: 'nm-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="lateral">
      <a class="marca" routerLink="/panel"><span class="foco">✦</span> Nuva<b>Mail</b></a>
      <nav aria-label="Principal">
        @for (m of menu; track m.ruta) {
          <a [routerLink]="m.ruta" routerLinkActive="activo"><span class="ico" aria-hidden="true">{{ m.ico }}</span>{{ m.texto }}</a>
        }
      </nav>
      <div class="usuario">
        <div><b>{{ sesion.usuario()?.nombre }}</b><small>{{ sesion.usuario()?.empresa }} · {{ sesion.usuario()?.rol }}</small></div>
        <button class="btn fantasma pequeno" (click)="salir()">Salir</button>
      </div>
    </aside>
    <main class="contenido"><router-outlet /></main>
    <div class="avisos" aria-live="polite">
      @for (a of avisos.lista(); track a.id) { <div class="aviso" [class]="a.tipo">{{ a.texto }}</div> }
    </div>
  `,
})
export class Shell {
  protected sesion = inject(Sesion);
  protected avisos = inject(Avisos);
  private router = inject(Router);
  protected menu = [
    { ruta: '/panel', texto: 'Panel', ico: '◧' },
    { ruta: '/campanas', texto: 'Campañas', ico: '✉' },
    { ruta: '/plantillas', texto: 'Diseños de correo', ico: '▦' },
    { ruta: '/contactos', texto: 'Contactos', ico: '☺' },
    { ruta: '/entregabilidad', texto: 'Entregabilidad', ico: '✓' },
    { ruta: '/configuracion', texto: 'Configuración', ico: '⚙' },
  ];
  async salir() {
    await this.sesion.salir();
    this.router.navigate(['/login']);
  }
}
