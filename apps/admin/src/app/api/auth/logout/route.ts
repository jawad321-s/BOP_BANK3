import { NextRequest, NextResponse } from 'next/server';
import { callApi, clearSessionCookies, csrfOk, errorResponse } from '@/lib/bff';
import { COOKIE } from '@/lib/server-config';

export async function POST(req: NextRequest) {
  if (!csrfOk(req)) return errorResponse(403, 'FORBIDDEN', 'CSRF check failed');
  const token = req.cookies.get(COOKIE.access)?.value;
  if (token) await callApi('/v1/auth/logout', { method: 'POST', token }).catch(() => undefined);
  const res = NextResponse.json({ status: 'OK' });
  clearSessionCookies(res);
  return res;
}
