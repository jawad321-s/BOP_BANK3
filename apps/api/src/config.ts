import { z } from 'zod';
import { isValidTimeZone } from '@bitaqati/shared';

/**
 * Environment configuration, validated at boot.
 * Production refuses to start when a critical setting is missing — it never falls back to a simulator.
 */
const boolish = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(60),
  MFA_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  PUBLIC_APP_LINK_BASE: z.string().url().default('http://localhost:3000'),
  ADMIN_ORIGIN: z.string().url().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY: boolish,
  // email
  MAIL_TRANSPORT: z.enum(['smtp', 'memory']).default('memory'),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Bitaqati <no-reply@example.invalid>'),
  // push
  PUSH_PROVIDER: z.enum(['expo', 'log']).default('log'),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  // storage
  STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: boolish,
  // business
  DEFAULT_TIMEZONE: z.string().refine(isValidTimeZone).default('Asia/Hebron'),
  QR_TTL_SECONDS: z.coerce.number().int().min(20).max(300).default(60),
  VERIFICATION_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  QUOTE_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  MAX_INVOICE_MINOR: z.coerce.number().int().min(100).default(5_000_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = Omit<z.infer<typeof schema>, 'JWT_ACCESS_SECRET' | 'MFA_ENCRYPTION_KEY'> & { JWT_ACCESS_SECRET: string; MFA_ENCRYPTION_KEY: string; isProduction: boolean };

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const c = parsed.data;
  const isProduction = c.NODE_ENV === 'production';
  const strict = isProduction || c.APP_ENV === 'staging' || c.APP_ENV === 'production';
  const missing: string[] = [];
  if (strict) {
    if (!c.JWT_ACCESS_SECRET) missing.push('JWT_ACCESS_SECRET');
    if (!c.MFA_ENCRYPTION_KEY) missing.push('MFA_ENCRYPTION_KEY');
    if (!c.REDIS_URL) missing.push('REDIS_URL');
    if (c.MAIL_TRANSPORT !== 'smtp' || !c.SMTP_URL) missing.push('MAIL_TRANSPORT=smtp + SMTP_URL');
    if (c.PUSH_PROVIDER !== 'expo') missing.push('PUSH_PROVIDER=expo');
    if (c.STORAGE_DRIVER !== 's3' || !c.S3_BUCKET || !c.S3_ACCESS_KEY_ID || !c.S3_SECRET_ACCESS_KEY) missing.push('STORAGE_DRIVER=s3 + S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY');
    if (!c.PUBLIC_API_URL.startsWith('https://')) missing.push('PUBLIC_API_URL must be https');
  }
  if (c.MAIL_TRANSPORT === 'smtp' && !c.SMTP_URL) missing.push('SMTP_URL');
  if (missing.length) throw new Error(`Missing required production configuration: ${missing.join(', ')}`);

  cached = {
    ...c,
    // Development-only fallbacks, never used when strict.
    JWT_ACCESS_SECRET: c.JWT_ACCESS_SECRET ?? 'dev-only-insecure-jwt-secret-change-me-0000',
    MFA_ENCRYPTION_KEY: c.MFA_ENCRYPTION_KEY ?? '0'.repeat(64),
    isProduction,
  };
  return cached;
}

export function config(): AppConfig {
  return cached ?? loadConfig();
}

export function resetConfigForTests(): void {
  cached = null;
}
