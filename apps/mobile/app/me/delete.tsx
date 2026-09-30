import { useState } from 'react';
import { router } from 'expo-router';
import { api, clearTokens } from '../../src/lib/api';
import { Banner, Button, ErrorState, Field, Screen, Title } from '../../src/components/ui';
import { useAuth } from '../../src/state/auth';
import { useT } from '../../src/state/lang';

/** In-app account deletion with re-authentication (App Store Guideline 5.1.1(v)). */
export default function DeleteAccount() {
  const t = useT();
  const { signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Screen>
      <Title>{t('deleteAccount')}</Title>
      <Banner kind="warn">{t('deleteExplain')}</Banner>
      <Field label={t('password')} value={password} onChangeText={setPassword} secureTextEntry style={{ textAlign: 'left' }} />
      <Field label={t('typeDelete')} value={confirm} onChangeText={setConfirm} autoCapitalize="characters" style={{ textAlign: 'left' }} />
      {error ? <ErrorState error={error} /> : null}
      <Button title={t('deleteAccount')} variant="danger" loading={busy} disabled={!password || confirm !== 'DELETE'} onPress={async () => {
        setBusy(true);
        setError(null);
        try {
          await api('/v1/me/deletion-request', { method: 'POST', body: { password, confirm: 'DELETE' } });
          await clearTokens();
          await signOut().catch(() => undefined);
          router.replace('/welcome');
        } catch (e) {
          setError(e);
        } finally {
          setBusy(false);
        }
      }} />
    </Screen>
  );
}
