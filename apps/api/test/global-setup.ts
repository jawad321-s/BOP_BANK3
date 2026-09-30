import { execSync } from 'node:child_process';
import { Client } from 'pg';

/**
 * Creates a brand-new, uniquely named database for this test run and applies all migrations with
 * `prisma migrate deploy` (proving migrations apply cleanly to an empty database). No existing database
 * is reset or modified. The run's database is dropped in global-teardown.
 */
export default async function globalSetup(): Promise<void> {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://bitaqati:bitaqati@localhost:5432/postgres';
  const name = `bitaqati_test_run_${Date.now()}_${process.pid}`;
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  await client.query(`CREATE DATABASE "${name}"`);
  await client.end();
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  process.env.TEST_DATABASE_URL = url.toString();
  process.env.TEST_DATABASE_RUN_NAME = name;
  execSync('npx prisma migrate deploy', {
    cwd: __dirname + '/..',
    env: { ...process.env, DATABASE_URL: url.toString(), PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: 'pipe',
  });
}
