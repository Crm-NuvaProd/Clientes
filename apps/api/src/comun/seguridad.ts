import {
  CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, HttpException, HttpStatus,
  Injectable, SetMetadata, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export type Rol = 'admin' | 'editor' | 'analista';
export interface Sesion { sub: string; empresaId: string; rol: Rol; nombre: string }

export const COOKIE_SESION = 'nm_sesion';
const PUBLICO = 'publico';
const ROLES = 'roles';

/** Ruta sin sesión (baja, webhook de SES, login). */
export const Publico = () => SetMetadata(PUBLICO, true);
/** Roles permitidos. Sin este decorador, cualquier usuario con sesión (deny by default para anónimos). */
export const Roles = (...roles: Rol[]) => SetMetadata(ROLES, roles);

export const Usuario = createParamDecorator((_: unknown, ctx: ExecutionContext): Sesion => {
  return ctx.switchToHttp().getRequest().sesion;
});

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const destinos = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLICO, destinos)) return true;
    const req = ctx.switchToHttp().getRequest<Request & { sesion?: Sesion }>();
    const token = req.cookies?.[COOKIE_SESION];
    if (!token) throw new UnauthorizedException('Inicie sesión');
    try {
      req.sesion = await this.jwt.verifyAsync<Sesion>(token);
    } catch {
      throw new UnauthorizedException('La sesión expiró');
    }
    // Defensa CSRF adicional a SameSite=Strict: los cambios exigen una cabecera que un formulario
    // de otro sitio no puede enviar.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-nuvamail'] !== '1') {
      throw new ForbiddenException('Solicitud no permitida');
    }
    const roles = this.reflector.getAllAndOverride<Rol[]>(ROLES, destinos);
    if (roles && !roles.includes(req.sesion.rol)) throw new ForbiddenException('Su rol no tiene permiso');
    return true;
  }
}

/** Límite simple de solicitudes por IP y ruta (en memoria; con varias instancias use Redis). */
const ventanas = new Map<string, { n: number; hasta: number }>();
export function limitar(req: Request, clave: string, max: number, ventanaMs: number) {
  const k = `${clave}:${req.ip}`;
  const ahora = Date.now();
  const v = ventanas.get(k);
  if (!v || v.hasta < ahora) {
    ventanas.set(k, { n: 1, hasta: ahora + ventanaMs });
    if (ventanas.size > 50_000) for (const [kk, vv] of ventanas) if (vv.hasta < ahora) ventanas.delete(kk);
    return;
  }
  if (++v.n > max) throw new HttpException('Demasiadas solicitudes, intente en un momento', HttpStatus.TOO_MANY_REQUESTS);
}
