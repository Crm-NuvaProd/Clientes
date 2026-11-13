import { Injectable, OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import { config } from '../config.js';

// bigint (ids y COUNT) como number: los volúmenes de una pyme caben de sobra en 2^53
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export type Cliente = pg.PoolClient;

/**
 * Acceso a PostgreSQL. Toda operación de negocio pasa por `tx(empresaId, …)`, que abre una
 * transacción y fija `app.empresa_id`: las políticas RLS impiden ver filas de otra empresa
 * aunque un servicio olvide filtrar.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool = new pg.Pool({ connectionString: config.databaseUrl, max: 15 });

  async tx<T>(empresaId: string, fn: (c: Cliente) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.empresa_id', $1, true)", [empresaId]);
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  /** Consultas sin empresa: solo para funciones SECURITY DEFINER (login, trabajador, webhooks). */
  async sistema<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query<T>(sql, params)).rows;
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
