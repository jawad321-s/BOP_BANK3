import { NextRequest, NextResponse } from 'next/server';
import { callApi, csrfOk, errorResponse, lang } from '@/lib/bff';
import { COOKIE, cookieBase } from '@/lib/server-config';

/** Step 1: password. The MFA challenge token is kept in an HttpOnly cookie, never exposed to scripts. */
export async function POST(req: NextRequest) {
  if (!csrfOk(req)) return errorResponse(403, 'FORBIDDEN', 'CSRF check failed');
  const body = await req.json().catch(() => ({}));
  const r = await callApi('/v1/auth/admin/login', {
    method: 'POST',
    lang: lang(req),
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': req.headers.get('x-forwarded-for') ?? '' },
    body: JSON.stringify({ email: body.email, password: body.password, platform: 'web' }),
  });
  const json = await r.json();
  if (!r.ok) return NextResponse.json(json, { status: r.status });
  const res = NextResponse.json({ status: json.status, otpauthUrl: json.otpauthUrl, secret: json.secret });
  res.cookies.set(COOKIE.challenge, json.challengeToken, { ...cookieBase, path: '/api/auth', maxAge: 300 });
  return res;
}
