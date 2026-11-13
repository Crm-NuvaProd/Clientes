// Aplica migraciones SQL versionadas en orden (una vez cada una). Uso: node scripts/migrar.mjs
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error('Defina DATABASE_ADMIN_URL (rol dueño del esquema)');
const dir = path.join(import.meta.dirname, '..', 'migraciones');
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('CREATE TABLE IF NOT EXISTS schema_migraciones (version text PRIMARY KEY, aplicada timestamptz NOT NULL DEFAULT now())');
const hechas = new Set((await client.query('SELECT version FROM schema_migraciones')).rows.map((r) => r.version));
for (const f of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
  if (hechas.has(f)) continue;
  const sql = await readFile(path.join(dir, f), 'utf8');
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migraciones(version) VALUES ($1)', [f]);
    await client.query('COMMIT');
    console.log('Aplicada', f);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Falló', f, e.message);
    process.exit(1);
  }
}
// Alta automática de la primera empresa (útil en Render): solo si no existe ninguna.
const { SEMBRAR_EMPRESA, SEMBRAR_EMAIL, SEMBRAR_CLAVE, SEMBRAR_DOMINIO = '' } = process.env;
if (SEMBRAR_EMPRESA && SEMBRAR_EMAIL && SEMBRAR_CLAVE) {
  await client.query("SET app.sistema = 'on'");
  const { rows } = await client.query('SELECT count(*)::int n FROM empresas');
  if (rows[0].n === 0) {
    if (SEMBRAR_CLAVE.length < 12) { console.error('SEMBRAR_CLAVE debe tener 12 o más caracteres'); process.exit(1); }
    const argon2 = (await import('argon2')).default;
    const e = (await client.query(
      `INSERT INTO empresas(nombre, dominio_envio, from_email, from_nombre, reply_to, pie_legal)
       VALUES ($1,$2,$3,$1,$4,$5) RETURNING id`,
      [SEMBRAR_EMPRESA, SEMBRAR_DOMINIO, SEMBRAR_DOMINIO ? `novedades@${SEMBRAR_DOMINIO}` : '', SEMBRAR_EMAIL.toLowerCase(),
       `${SEMBRAR_EMPRESA} · Recibe este correo porque es cliente o contacto autorizado.`])).rows[0];
    await client.query('INSERT INTO usuarios(empresa_id,email,nombre,hash,rol) VALUES ($1,$2,$3,$4,$5)',
      [e.id, SEMBRAR_EMAIL.toLowerCase(), 'Administrador', await argon2.hash(SEMBRAR_CLAVE, { type: argon2.argon2id }), 'admin']);
    console.log('Empresa inicial creada:', SEMBRAR_EMPRESA);
  }
}
await client.end();
