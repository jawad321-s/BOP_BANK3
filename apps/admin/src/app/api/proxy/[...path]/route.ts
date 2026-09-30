import { NextRequest, NextResponse } from 'next/server';
import { callApi, clearSessionCookies, csrfOk, errorResponse, lang, refresh, setSessionCookies, type Tokens } from '@/lib/bff';
import { COOKIE } from '@/lib/server-config';

/** Only admin endpoints (plus public config) are reachable through the BFF. */
const ALLOWED = [/^v1\/admin\//, /^v1\/config$/];

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const joined = path.map(encodeURIComponent).join('/');
  if (!ALLOWED.some((re) => re.test(joined)) || path.some((p) => p === '..' || p === '.')) return errorResponse(404, 'NOT_FOUND', 'Not found');
  if (!csrfOk(req)) return errorResponse(403, 'FORBIDDEN', 'CSRF check failed');

  let token = req.cookies.get(COOKIE.access)?.value;
  const refreshToken = req.cookies.get(COOKIE.refresh)?.value;
  let rotated: Tokens | null = null;
  if (!token && refreshToken) {
    rotated = await refresh(refreshToken);
    token = rotated?.accessToken;
  }
  if (!token) {
    const res = errorResponse(401, 'UNAUTHENTICATED', 'Sign in required');
    clearSessionCookies(res);
    return res;
  }

  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  const send = (t: string) =>
    callApi(`/${joined}${req.nextUrl.search}`, {
      method: req.method,
      token: t,
      lang: lang(req),
      headers: {
        ...(req.headers.get('content-type') ? { 'Content-Type': req.headers.get('content-type')! } : {}),
        ...(req.headers.get('x-request-id') ? { 'X-Request-Id': req.headers.get('x-request-id')! } : {}),
      },
      body,
    });

  let upstream = await send(token);
  if (upstream.status === 401 && refreshToken && !rotated) {
    rotated = await refresh(refreshToken);
    if (rotated) upstream = await send(rotated.accessToken);
  }

  const headers = new Headers();
  for (const h of ['content-type', 'content-disposition', 'cache-control', 'x-request-id', 'retry-after']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  const res = new NextResponse(upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers });
  if (rotated) setSessionCookies(res, rotated);
  if (upstream.status === 401) clearSessionCookies(res);
  return res;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
export const dynamic = 'force-dynamic';
