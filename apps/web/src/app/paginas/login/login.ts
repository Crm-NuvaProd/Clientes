import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Sesion } from '../../core/api';

@Component({
  selector: 'nm-login',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="login">
      <form class="tarjeta" [formGroup]="form" (ngSubmit)="entrar()">
        <div class="marca grande">✦ Nuva<b>Mail</b></div>
        <p class="tenue">Correo masivo con entregabilidad cuidada</p>
        <label for="email">Correo</label>
        <input id="email" type="email" formControlName="email" autocomplete="username">
        <label for="clave">Clave</label>
        <input id="clave" type="password" formControlName="clave" autocomplete="current-password">
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
        <button class="btn ancho" [disabled]="form.invalid || cargando()">{{ cargando() ? 'Entrando…' : 'Entrar' }}</button>
      </form>
    </div>`,
})
export class Login {
  private sesion = inject(Sesion);
  private router = inject(Router);
  protected cargando = signal(false);
  protected error = signal('');
  protected form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    clave: ['', [Validators.required, Validators.minLength(8)]],
  });

  async entrar() {
    this.cargando.set(true);
    this.error.set('');
    try {
      const { email, clave } = this.form.getRawValue();
      await this.sesion.entrar(email, clave);
      this.router.navigate(['/panel']);
    } catch (e: any) {
      this.error.set(e?.error?.detail ?? 'No se pudo iniciar sesión');
    } finally {
      this.cargando.set(false);
    }
  }
}
