import 'server-only';

/** Server-only settings for the admin BFF. The browser never talks to the API directly. */
export function apiUrl(): string {
  const url = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
  if (process.env.NODE_ENV === 'production' && !process.env.API_INTERNAL_URL) throw new Error('API_INTERNAL_URL is required in production');
  return url.replace(/\/$/, '');
}

export const COOKIE = {
  access: 'bq_at',
  refresh: 'bq_rt',
  challenge: 'bq_mfa',
  lang: 'bq_lang',
} as const;

export const cookieBase = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
};
