import { NextRequest, NextResponse } from 'next/server';

/** Redirects unauthenticated page views to /login. API routes enforce auth themselves. */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/login') || pathname.startsWith('/api') || pathname.startsWith('/_next') || pathname === '/favicon.ico') return NextResponse.next();
  if (!req.cookies.get('bq_at') && !req.cookies.get('bq_s')) {
    // The refresh cookie is scoped to /api; `bq_s` marks that a refreshable session exists.
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
