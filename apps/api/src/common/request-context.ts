import type { Request } from 'express';

export interface AuthContext {
  userId: string;
  sessionId: string;
  mfaVerified: boolean;
}

export interface AppRequest extends Request {
  requestId: string;
  locale: 'ar' | 'en';
  auth?: AuthContext;
}

export function requestLocale(req: Request): 'ar' | 'en' {
  const h = (req.headers['accept-language'] ?? '').toString().toLowerCase();
  return h.startsWith('en') ? 'en' : 'ar';
}

export function clientIp(req: Request): string | undefined {
  return req.ip ?? undefined;
}
