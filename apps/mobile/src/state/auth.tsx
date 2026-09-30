import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import type { LoginResponse, MeResponse } from '@bitaqati/shared';
import { api, clearTokens, hasStoredSession, refreshSession, setSignedOutHandler, storeTokens } from '../lib/api';

export type Workspace = { kind: 'user' } | { kind: 'merchant'; membershipId: string };

interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  me: MeResponse | null;
  workspace: Workspace;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithTokens: (t: Extract<LoginResponse, { status: 'OK' }>) => Promise<void>;
  signOut: () => Promise<void>;
  reloadMe: () => Promise<MeResponse | null>;
  setWorkspace: (w: Workspace) => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const WS_KEY = 'bitaqati.workspace';

/**
 * The workspace switch only changes which UI is shown. Every merchant/admin permission is enforced by the
 * API from the account's memberships; switching never grants anything.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [workspace, setWs] = useState<Workspace>({ kind: 'user' });

  const reloadMe = useCallback(async () => {
    try {
      const m = await api<MeResponse>('/v1/me');
      setMe(m);
      setStatus('signedIn');
      const stored = await AsyncStorage.getItem(WS_KEY);
      const parsed: Workspace = stored ? JSON.parse(stored) : { kind: 'user' };
      if (parsed.kind === 'merchant' && !m.workspaces.merchant.some((x) => x.membershipId === parsed.membershipId)) setWs({ kind: 'user' });
      else setWs(parsed);
      return m;
    } catch (e) {
      if ((e as { status?: number }).status === 401) setStatus('signedOut');
      throw e;
    }
  }, []);

  useEffect(() => {
    setSignedOutHandler(() => {
      setMe(null);
      setStatus('signedOut');
      qc.clear();
    });
    (async () => {
      if (!(await hasStoredSession())) return setStatus('signedOut');
      const ok = await refreshSession();
      if (!ok && !(await hasStoredSession())) return setStatus('signedOut');
      await reloadMe().catch(() => {
        // offline at launch with a stored session: keep signed-in state, screens show offline state
        setStatus((s) => (s === 'loading' ? 'signedIn' : s));
      });
    })();
  }, [qc, reloadMe]);

  const signInWithTokens = useCallback(
    async (t: Extract<LoginResponse, { status: 'OK' }>) => {
      await storeTokens(t);
      await reloadMe();
    },
    [reloadMe],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const r = await api<LoginResponse>('/v1/auth/login', { method: 'POST', auth: false, body: { email, password, platform: 'ios', deviceName: 'iPhone' } });
      if (r.status !== 'OK') throw new Error('unexpected');
      await signInWithTokens(r);
    },
    [signInWithTokens],
  );

  const signOut = useCallback(async () => {
    await api('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    await clearTokens();
    await AsyncStorage.removeItem(WS_KEY);
    qc.clear();
    setMe(null);
    setWs({ kind: 'user' });
    setStatus('signedOut');
  }, [qc]);

  const setWorkspace = useCallback(async (w: Workspace) => {
    await AsyncStorage.setItem(WS_KEY, JSON.stringify(w));
    qc.clear();
    setWs(w);
  }, [qc]);

  const value = useMemo(() => ({ status, me, workspace, signIn, signInWithTokens, signOut, reloadMe, setWorkspace }), [status, me, workspace, signIn, signInWithTokens, signOut, reloadMe, setWorkspace]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}

export function useMerchantWorkspace() {
  const { me, workspace } = useAuth();
  if (workspace.kind !== 'merchant' || !me) return null;
  return me.workspaces.merchant.find((m) => m.membershipId === workspace.membershipId) ?? null;
}
