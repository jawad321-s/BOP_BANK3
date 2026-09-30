import { defineConfig } from '@playwright/test';

/**
 * Full-stack E2E: real API + worker + admin web, fresh PostgreSQL database, Redis, and a local SMTP sink.
 * The mobile UI itself must be verified on a physical iPhone (see docs/test-report.md).
 */
process.env.E2E_DB ??= `bitaqati_e2e_${Date.now()}`;
const DB_URL = `postgresql://bitaqati:bitaqati@localhost:5432/${process.env.E2E_DB}`;
const env = {
  DATABASE_URL: DB_URL,
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  APP_ENV: 'development',
  PORT: '4100',
  PUBLIC_API_URL: 'http://localhost:4100',
  MAIL_TRANSPORT: 'smtp',
  SMTP_URL: 'smtp://127.0.0.1:2525',
  PUSH_PROVIDER: 'log',
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: `/tmp/${process.env.E2E_DB}`,
  LOG_LEVEL: 'warn',
  E2E_DB: process.env.E2E_DB,
};

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  globalTeardown: './teardown.ts',
  use: { baseURL: 'http://localhost:3100', launchOptions: { executablePath: process.env.CHROMIUM_PATH } },
  webServer: [
    { command: 'node smtp-sink.mjs', port: 2526, reuseExistingServer: false },
    {
      command: 'node prepare-db.mjs && cd ../apps/api && npx prisma migrate deploy && npx ts-node --transpile-only prisma/seed.ts && (npx ts-node --transpile-only src/worker.ts & npx ts-node --transpile-only src/main.ts)',
      url: 'http://localhost:4100/ready',
      env,
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      command: 'cd ../apps/admin && npx next start -p 3100',
      url: 'http://localhost:3100/login',
      env: { API_INTERNAL_URL: 'http://localhost:4100', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
