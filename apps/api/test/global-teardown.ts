import { Client } from 'pg';

/** Drops only the database created by this run's global-setup. */
export default async function globalTeardown(): Promise<void> {
  const name = process.env.TEST_DATABASE_RUN_NAME;
  if (!name || !name.startsWith('bitaqati_test_run_') || process.env.KEEP_TEST_DB) return;
  const client = new Client({ connectionString: process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://bitaqati:bitaqati@localhost:5432/postgres' });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await client.end();
}
