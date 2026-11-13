// Crea una empresa y su usuario administrador. Uso:
// node scripts/sembrar.mjs "NuvaProd S.A.S." admin@nuvaprod.com "Clave-Larga-123" mail.nuvaprod.com
import argon2 from 'argon2';
import pg from 'pg';

const [nombre, email, clave, dominio = ''] = process.argv.slice(2);
if (!nombre || !email || !clave || clave.length < 12) {
  console.error('Uso: node scripts/sembrar.mjs <empresa> <email> <clave de 12+ caracteres> [dominio_envio]');
  process.exit(1);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
await client.connect();
await client.query("SET app.sistema = 'on'");
const { rows } = await client.query(
  `INSERT INTO empresas(nombre, dominio_envio, from_email, from_nombre, reply_to, pie_legal)
   VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
  [nombre, dominio, dominio ? `novedades@${dominio}` : '', nombre, email,
   `${nombre} · Recibe este correo porque es cliente o contacto autorizado.`],
);
const hash = await argon2.hash(clave, { type: argon2.argon2id });
await client.query('INSERT INTO usuarios(empresa_id, email, nombre, hash, rol) VALUES ($1,$2,$3,$4,$5)',
  [rows[0].id, email.toLowerCase(), 'Administrador', hash, 'admin']);
console.log('Empresa creada', rows[0].id);
await client.end();
