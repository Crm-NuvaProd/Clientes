import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

/** Errores en formato RFC 7807, sin trazas ni SQL hacia el cliente. */
@Catch()
export class ProblemaFilter implements ExceptionFilter {
  private log = new Logger('Errores');

  catch(ex: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let detalle: string | string[] = 'Error interno. Intente de nuevo.';
    if (ex instanceof HttpException) {
      status = ex.getStatus();
      const r = ex.getResponse() as any;
      detalle = typeof r === 'string' ? r : (r?.message ?? ex.message);
    } else if ((ex as any)?.code === '23505') {
      status = 409;
      detalle = 'Ya existe un registro con esos datos.';
    } else {
      this.log.error((ex as Error)?.message, (ex as Error)?.stack);
    }
    res.status(status).type('application/problem+json').json({
      type: 'about:blank',
      title: status >= 500 ? 'Error interno' : 'Solicitud no válida',
      status,
      detail: Array.isArray(detalle) ? detalle.join('. ') : detalle,
    });
  }
}
