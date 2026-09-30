import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { apiUrl, COOKIE, cookieBase } from './server-config';

export interface Tokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export function setSessionCookies(res: NextResponse, t: Tokens): void {
  res.cookies.set(COOKIE.access, t.accessToken, { ...cookieBase, expires: new Date(t.accessTokenExpiresAt) });
  // Refresh cookie is scoped to the BFF routes only.
  res.cookies.set(COOKIE.refresh, t.refreshToken, { ...cookieBase, path: '/api', expires: new Date(t.refreshTokenExpiresAt) });
  // Non-secret marker so page middleware knows a refreshable session exists.
  res.cookies.set('bq_s', '1', { ...cookieBase, expires: new Date(t.refreshTokenExpiresAt) });
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set(COOKIE.access, '', { ...cookieBase, maxAge: 0 });
  res.cookies.set(COOKIE.refresh, '', { ...cookieBase, path: '/api', maxAge: 0 });
  res.cookies.set(COOKIE.challenge, '', { ...cookieBase, path: '/api/auth', maxAge: 0 });
  res.cookies.set('bq_s', '', { ...cookieBase, maxAge: 0 });
}

/**
 * CSRF defence for cookie-authenticated BFF routes: SameSite=Strict cookies, plus for every state-changing
 * request a same-origin Origin header and a custom header that cross-site forms cannot set.
 */
export function csrfOk(req: NextRequest): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  if (req.headers.get('x-bitaqati-csrf') !== '1') return false;
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function lang(req: NextRequest): 'ar' | 'en' {
  return req.cookies.get(COOKIE.lang)?.value === 'en' ? 'en' : 'ar';
}

export async function callApi(path: string, init: RequestInit & { token?: string; lang?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  if (init.lang) headers.set('Accept-Language', init.lang);
  return fetch(`${apiUrl()}${path}`, { ...init, headers, cache: 'no-store', redirect: 'manual' });
}

export async function refresh(refreshToken: string): Promise<Tokens | null> {
  const r = await callApi('/v1/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
  if (!r.ok) return null;
  return (await r.json()) as Tokens;
}

export function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message, requestId: 'bff' } }, { status });
}
