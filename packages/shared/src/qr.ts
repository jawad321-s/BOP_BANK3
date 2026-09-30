/** QR payload format: "BTQ1.<token>". The token is random and carries no personal data. */
export const QR_PREFIX = 'BTQ1.';

export function encodeQrPayload(token: string): string {
  return `${QR_PREFIX}${token}`;
}

export function decodeQrPayload(payload: string): string | null {
  const p = payload.trim();
  if (!p.startsWith(QR_PREFIX)) return null;
  const token = p.slice(QR_PREFIX.length);
  return /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : null;
}
