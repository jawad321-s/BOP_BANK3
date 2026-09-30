import { loadConfig, resetConfigForTests } from '../src/config';

afterAll(() => resetConfigForTests());

describe('configuration', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

  it('production refuses to start without critical settings (no silent simulators)', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/JWT_ACCESS_SECRET.*MFA_ENCRYPTION_KEY.*REDIS_URL.*SMTP_URL.*PUSH_PROVIDER=expo.*STORAGE_DRIVER=s3/);
  });

  it('staging is as strict as production', () => {
    expect(() => loadConfig({ ...base, APP_ENV: 'staging' } as NodeJS.ProcessEnv)).toThrow(/Missing required production configuration/);
  });

  it('production accepts a complete configuration', () => {
    const c = loadConfig({
      ...base,
      NODE_ENV: 'production',
      APP_ENV: 'production',
      JWT_ACCESS_SECRET: 'x'.repeat(48),
      MFA_ENCRYPTION_KEY: 'a'.repeat(64),
      REDIS_URL: 'redis://localhost:6379',
      MAIL_TRANSPORT: 'smtp',
      SMTP_URL: 'smtp://user:pass@smtp.example.com:587',
      PUSH_PROVIDER: 'expo',
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'b',
      S3_ACCESS_KEY_ID: 'k',
      S3_SECRET_ACCESS_KEY: 's',
      PUBLIC_API_URL: 'https://api.example.com',
    } as NodeJS.ProcessEnv);
    expect(c.isProduction).toBe(true);
  });

  it('rejects an invalid time zone', () => {
    expect(() => loadConfig({ ...base, DEFAULT_TIMEZONE: 'Nowhere/City' } as NodeJS.ProcessEnv)).toThrow(/DEFAULT_TIMEZONE/);
  });
});
