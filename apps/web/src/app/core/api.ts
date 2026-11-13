import { HttpClient, HttpErrorResponse, HttpInterceptorFn, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, firstValueFrom, throwError } from 'rxjs';

const BASE = '/api/v1';

/** Avisos tipo "toast". */
@Injectable({ providedIn: 'root' })
export class Avisos {
  readonly lista = signal<{ id: number; texto: string; tipo: 'ok' | 'error' | 'info' }[]>([]);
  private n = 0;
  mostrar(texto: string, tipo: 'ok' | 'error' | 'info' = 'ok') {
    const id = ++this.n;
    this.lista.update((l) => [...l, { id, texto, tipo }]);
    setTimeout(() => this.lista.update((l) => l.filter((a) => a.id !== id)), tipo === 'error' ? 7000 : 3500);
  }
}

/** Agrega la cabecera anti-CSRF, envía la cookie de sesión y traduce errores. */
export const interceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const avisos = inject(Avisos);
  const r = req.url.startsWith(BASE) ? req.clone({ withCredentials: true, setHeaders: { 'x-nuvamail': '1' } }) : req;
  return next(r).pipe(
    catchError((e: HttpErrorResponse) => {
      if (e.status === 401 && !req.url.endsWith('/auth/login')) {
        router.navigate(['/login']);
      } else if (e.status !== 401) {
        avisos.mostrar(e.error?.detail ?? (e.status === 0 ? 'Sin conexión con el servidor' : 'Error inesperado'), 'error');
      }
      return throwError(() => e);
    }),
  );
};

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);

  get<T>(ruta: string, params?: Record<string, string | number | undefined | null>): Promise<T> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    return firstValueFrom(this.http.get<T>(BASE + ruta, { params: p }));
  }
  post<T>(ruta: string, cuerpo: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(BASE + ruta, cuerpo));
  }
  put<T>(ruta: string, cuerpo: unknown): Promise<T> {
    return firstValueFrom(this.http.put<T>(BASE + ruta, cuerpo));
  }
  delete(ruta: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(BASE + ruta));
  }
  url(ruta: string) {
    return BASE + ruta;
  }
}

export interface Usuario { nombre: string; rol: 'admin' | 'editor' | 'analista'; empresa: string }

@Injectable({ providedIn: 'root' })
export class Sesion {
  private api = inject(Api);
  readonly usuario = signal<Usuario | null>(null);

  async cargar(): Promise<boolean> {
    if (this.usuario()) return true;
    try {
      this.usuario.set(await this.api.get<Usuario>('/auth/yo'));
      return true;
    } catch {
      return false;
    }
  }
  async entrar(email: string, clave: string) {
    await this.api.post('/auth/login', { email, clave });
    this.usuario.set(null);
    await this.cargar();
  }
  async salir() {
    await this.api.post('/auth/logout');
    this.usuario.set(null);
  }
  puede(...roles: Usuario['rol'][]) {
    const u = this.usuario();
    return !!u && roles.includes(u.rol);
  }
}

export const conSesion: CanActivateFn = async () => {
  const ok = await inject(Sesion).cargar();
  return ok || inject(Router).parseUrl('/login');
};

// ---------- Formatos es-CO ----------
export const pct = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : `${(v * 100).toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d })} %`;
export const num = (v: number | null | undefined) => (v ?? 0).toLocaleString('es-CO');
export const fecha = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const ESTADOS_CAMPANA: Record<string, string> = {
  borrador: 'Borrador', programada: 'Programada', prueba_ab: 'Prueba A/B', enviando: 'Enviando', pausada: 'Pausada', terminada: 'Terminada',
};
export const ESTADOS_CONTACTO: Record<string, string> = {
  activo: 'Activo', baja: 'Dado de baja', rebote: 'Rebotado', queja: 'Queja (spam)', invalido: 'Inválido',
};
