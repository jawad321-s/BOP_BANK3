import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Minimal HS256 JWT. Only used for short-lived access and MFA-challenge tokens. */
export function signJwt(payload: Record<string, unknown>, secret: string, ttlSeconds: number, now = Date.now()): { token: string; expiresAt: Date } {
  const iat = Math.floor(now / 1000);
  const exp = iat + ttlSeconds;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat, exp })).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return { token: `${header}.${body}.${sig}`, expiresAt: new Date(exp * 1000) };
}

export function verifyJwt<T extends Record<string, unknown>>(token: string, secret: string, now = Date.now()): (T & { iat: number; exp: number }) | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const h = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (h.alg !== 'HS256') return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof p.exp !== 'number' || p.exp * 1000 <= now) return null;
    return p;
  } catch {
    return null;
  }
}

/** AES-256-GCM for small secrets at rest (e.g. TOTP seeds). Key is 32 bytes hex. */
export function encryptSecret(plain: string, keyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(blob: string, keyHex: string): string {
  const [iv, tag, enc] = blob.split('.').map((p) => Buffer.from(p, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Card serial: BT-XXXX-XXXX-XXXX from 60 random bits (Crockford base32, no I/L/O/U). Not a secret. */
export function generateSerial(): string {
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += CROCKFORD[bytes[i] & 31];
  return `BT-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

export function normalizeSerial(input: string): string {
  const s = input.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  const body = s.startsWith('BT') ? s.slice(2) : s;
  if (body.length !== 12) return '';
  return `BT-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

/** Human-friendly redemption reference, e.g. R-20260115-7K3M9Q. */
export function redemptionRef(businessDate: string): string {
  const bytes = randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += CROCKFORD[bytes[i] & 31];
  return `R-${businessDate.replace(/-/g, '')}-${s}`;
}
