import { useState } from 'react';
import { api } from '../../src/lib/api';
import { Banner, Button, ErrorState, Field, Screen, Title } from '../../src/components/ui';
import { useAuth } from '../../src/state/auth';
import { useT } from '../../src/state/lang';

export default function Profile() {
  const t = useT();
  const { me, reloadMe } = useAuth();
  const [name, setName] = useState(me?.fullName ?? '');
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  return (
    <Screen>
      <Title>{t('profile')}</Title>
      <Field label={t('fullName')} value={name} onChangeText={setName} />
      <Button title={t('save')} onPress={async () => {
        setError(null);
        try {
          await api('/v1/me', { method: 'PATCH', body: { fullName: name.trim() } });
          await reloadMe();
          setMsg('✓');
        } catch (e) {
          setError(e);
        }
      }} />
      <Field label={t('email')} value={newEmail} onChangeText={setNewEmail} autoCapitalize="none" keyboardType="email-address" placeholder={me?.email} style={{ textAlign: 'left' }} />
      <Field label={t('currentPassword')} value={password} onChangeText={setPassword} secureTextEntry style={{ textAlign: 'left' }} />
      <Button title={t('submit')} variant="secondary" disabled={!newEmail || !password} onPress={async () => {
        setError(null);
        try {
          await api('/v1/me/email/change', { method: 'POST', body: { newEmail: newEmail.trim(), password } });
          setPassword('');
          setMsg(t('checkEmail'));
        } catch (e) {
          setError(e);
        }
      }} />
      {msg ? <Banner kind="ok">{msg}</Banner> : null}
      {error ? <ErrorState error={error} /> : null}
    </Screen>
  );
}
