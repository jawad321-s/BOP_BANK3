import * as SecureStore from 'expo-secure-store';
import type { AuthTokens } from '@bitaqati/shared';
import { API_URL } from './config';
import { getLang } from './i18n';

/** Error from the API (stable `code`, localized `message`) or a network failure (`code = NETWORK`). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
  get isNetwork() {
    return this.code === 'NETWORK';
  }
}

const REFRESH_KEY = 'bitaqati.refresh';
let accessToken: string | null = null;
let accessExpiresAt = 0;
let refreshing: Promise<boolean> | null = null;
let onSignedOut: (() => void) | null = null;

export function setSignedOutHandler(fn: () => void) {
  onSignedOut = fn;
}

/** Refresh token lives in the iOS Keychain (SecureStore); the access token only in memory. */
export async function storeTokens(t: AuthTokens): Promise<void> {
  accessToken = t.accessToken;
  accessExpiresAt = Date.parse(t.accessTokenExpiresAt);
  await SecureStore.setItemAsync(REFRESH_KEY, t.refreshToken, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  accessExpiresAt = 0;
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export async function hasStoredSession(): Promise<boolean> {
  return !!(await SecureStore.getItemAsync(REFRESH_KEY));
}

export function authHeader(): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

async function doRefresh(): Promise<boolean> {
  const rt = await SecureStore.getItemAsync(REFRESH_KEY);
  if (!rt) return false;
  try {
    const r = await fetch(`${API_URL}/v1/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) });
    if (!r.ok) {
      if (r.status === 401) await clearTokens();
      return false;
    }
    await storeTokens((await r.json()) as AuthTokens);
    return true;
  } catch {
    return false; // network: keep refresh token for later
  }
}

/** Single-flight refresh so concurrent requests don't rotate the token twice (which would look like reuse). */
export function refreshSession(): Promise<boolean> {
  refreshing ??= doRefresh().finally(() => (refreshing = null));
  return refreshing;
}

export async function ensureAccess(): Promise<string | null> {
  if (!accessToken || Date.now() > accessExpiresAt - 30_000) await refreshSession();
  return accessToken;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  auth?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const wantsAuth = opts.auth !== false;
  const send = async () => {
    const headers: Record<string, string> = { 'Accept-Language': getLang(), ...(opts.headers ?? {}) };
    if (wantsAuth) {
      const tok = await ensureAccess();
      if (tok) headers.Authorization = `Bearer ${tok}`;
    }
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    try {
      return await fetch(`${API_URL}${path}`, { method: opts.method ?? 'GET', headers, body });
    } catch {
      throw new ApiError(0, 'NETWORK', '');
    }
  };
  let res = await send();
  if (res.status === 401 && wantsAuth && accessToken) {
    accessToken = null;
    if (await refreshSession()) res = await send();
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const e = (json as { error?: { code: string; message: string; details?: Record<string, unknown> } } | undefined)?.error;
    if (res.status === 401 && wantsAuth) {
      await clearTokens();
      onSignedOut?.();
    }
    throw new ApiError(res.status, e?.code ?? 'INTERNAL_ERROR', e?.message ?? '', e?.details);
  }
  return json as T;
}

/** Generates a random idempotency key (16+ url-safe chars). */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return 'm_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
