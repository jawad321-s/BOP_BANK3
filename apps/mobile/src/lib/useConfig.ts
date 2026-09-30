import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface PublicConfig {
  appName: { ar: string; en: string };
  supportEmail: string | null;
  supportPhone: string | null;
  privacyUrl: string | null;
  termsUrl: string | null;
  timezone: string;
  qrTtlSeconds: number;
  maxInvoiceMinor: number;
}

export function useConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => api<PublicConfig>('/v1/config', { auth: false }), staleTime: 3600_000 });
}

/** Accepts a raw token or a pasted link containing ?token=… */
export function extractToken(input: string): string {
  const m = /token=([^&\s]+)/.exec(input);
  return (m ? decodeURIComponent(m[1]) : input).trim();
}
