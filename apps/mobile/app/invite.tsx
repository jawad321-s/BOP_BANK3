import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import type { AuthTokens } from '@bitaqati/shared';
import { api } from '../src/lib/api';
import { extractToken } from '../src/lib/useConfig';
import { Body, Button, ErrorState, Field, Screen, Title } from '../src/components/ui';
import { useAuth } from '../src/state/auth';
import { useT } from '../src/state/lang';

/** Merchant/admin roles are only granted through invitations; existing accounts must re-enter their password. */
export default function Invite() {
  const t = useT();
  const { signInWithTokens } = useAuth();
  const params = useLocalSearchParams<{ token?: string }>();
  const [token, setToken] = useState(params.token ?? '');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Screen>
      <Title>{t('invitationAccept')}</Title>
      <Body muted>{t('passwordHint')}</Body>
      <Field label={t('pasteToken')} value={token} onChangeText={setToken} autoCapitalize="none" style={{ textAlign: 'left' }} />
      <Field label={t('fullName')} value={fullName} onChangeText={setFullName} />
      <Field label={t('password')} value={password} onChangeText={setPassword} secureTextEntry style={{ textAlign: 'left' }} />
      {error ? <ErrorState error={error} /> : null}
      <Button title={t('submit')} loading={busy} disabled={!token || !password} onPress={async () => {
        setBusy(true);
        setError(null);
        try {
          const r = await api<AuthTokens>('/v1/auth/invitations/accept', { method: 'POST', auth: false, body: { token: extractToken(token), password, ...(fullName.trim().length >= 2 ? { fullName: fullName.trim() } : {}) } });
          await signInWithTokens({ status: 'OK', ...r });
          router.replace('/');
        } catch (e) {
          setError(e);
        } finally {
          setBusy(false);
        }
      }} />
    </Screen>
  );
}
