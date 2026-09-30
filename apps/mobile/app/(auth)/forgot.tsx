import { useState } from 'react';
import { router } from 'expo-router';
import { api } from '../../src/lib/api';
import { Banner, Button, ErrorState, Field, Screen, Title } from '../../src/components/ui';
import { useT } from '../../src/state/lang';

export default function Forgot() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Screen>
      <Title>{t('forgotPassword')}</Title>
      {sent ? (
        <>
          <Banner kind="ok">{t('checkEmail')}</Banner>
          <Button title={t('haveToken')} onPress={() => router.push('/reset-password')} />
        </>
      ) : (
        <>
          <Field label={t('email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={{ textAlign: 'left' }} />
          {error ? <ErrorState error={error} /> : null}
          <Button title={t('submit')} loading={busy} disabled={!email.includes('@')} onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              await api('/v1/auth/password/forgot', { method: 'POST', auth: false, body: { email: email.trim() } });
              setSent(true);
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
