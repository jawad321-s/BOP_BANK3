import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../src/lib/api';
import { extractToken } from '../src/lib/useConfig';
import { Banner, Button, ErrorState, Field, Screen, Title } from '../src/components/ui';
import { useT } from '../src/state/lang';

export default function Screen_() {
  const t = useT();
  const params = useLocalSearchParams<{ token?: string }>();
  const [token, setToken] = useState(params.token ?? '');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  return (
    <Screen>
      <Title>{t('submit')}</Title>
      {done ? (
        <>
          <Banner kind="ok">✓</Banner>
          <Button title={t('signIn')} onPress={() => router.replace('/login')} />
        </>
      ) : (
        <>
          <Field label={t('pasteToken')} value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} style={{ textAlign: 'left' }} />

          {error ? <ErrorState error={error} /> : null}
          <Button title={t('submit')} loading={busy} disabled={!token} onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              await api('/v1/auth/email/confirm-change', { method: 'POST', auth: false, body: { token: extractToken(token) } });
              setDone(true);
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }} />
        </>
      )}
    </Screen>
  );
}
