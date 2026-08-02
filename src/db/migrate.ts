import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from './client.js';

const migrationDir = join(process.cwd(), 'migrations');
const files = (await readdir(migrationDir)).filter((f) => f.endsWith('.sql')).sort();
await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
for (const file of files) {
  const applied = await db.query('SELECT 1 FROM schema_migrations WHERE id = $1', [file]);
  if (applied.rowCount) continue;
  const client = await db.connect();
  try { await client.query('BEGIN'); await client.query(await readFile(join(migrationDir, file), 'utf8')); await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]); await client.query('COMMIT'); }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
await db.end();
