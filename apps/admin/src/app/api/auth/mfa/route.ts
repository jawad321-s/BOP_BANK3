import { NextRequest, NextResponse } from 'next/server';
import { callApi, csrfOk, errorResponse, lang, setSessionCookies } from '@/lib/bff';
import { COOKIE, cookieBase } from '@/lib/server-config';

/** Step 2: TOTP (or enrollment confirmation). On success the session lives only in HttpOnly cookies. */
export async function POST(req: NextRequest) {
  if (!csrfOk(req)) return errorResponse(403, 'FORBIDDEN', 'CSRF check failed');
  const challengeToken = req.cookies.get(COOKIE.challenge)?.value;
  if (!challengeToken) return errorResponse(401, 'SESSION_EXPIRED', 'Challenge expired');
  const body = await req.json().catch(() => ({}));
  const path = body.enroll ? '/v1/auth/admin/mfa/enroll' : '/v1/auth/admin/mfa/verify';
  const r = await callApi(path, { method: 'POST', lang: lang(req), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeToken, code: String(body.code ?? '') }) });
  const json = await r.json();
  if (!r.ok) return NextResponse.json(json, { status: r.status });
  const res = NextResponse.json({ status: 'OK', recoveryCodes: json.recoveryCodes ?? null });
  setSessionCookies(res, json);
  res.cookies.set(COOKIE.challenge, '', { ...cookieBase, path: '/api/auth', maxAge: 0 });
  return res;
}
