import { Client } from 'pg';

export default async function teardown(): Promise<void> {
  const name = process.env.E2E_DB;
  if (!name?.startsWith('bitaqati_e2e_') || process.env.KEEP_E2E_DB) return;
  const c = new Client({ connectionString: process.env.E2E_ADMIN_DB_URL ?? 'postgresql://bitaqati:bitaqati@localhost:5432/postgres' });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await c.end();
}
