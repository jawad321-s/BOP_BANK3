import { NextRequest, NextResponse } from 'next/server';
import { csrfOk, errorResponse } from '@/lib/bff';
import { COOKIE } from '@/lib/server-config';

export async function POST(req: NextRequest) {
  if (!csrfOk(req)) return errorResponse(403, 'FORBIDDEN', 'CSRF check failed');
  const { lang } = await req.json().catch(() => ({ lang: 'ar' }));
  const res = NextResponse.json({ lang: lang === 'en' ? 'en' : 'ar' });
  res.cookies.set(COOKIE.lang, lang === 'en' ? 'en' : 'ar', { path: '/', sameSite: 'lax', maxAge: 31536000 });
  return res;
}
