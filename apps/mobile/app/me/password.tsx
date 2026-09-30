import { useState } from 'react';
import { api } from '../../src/lib/api';
import { Banner, Button, ErrorState, Field, Screen, Title } from '../../src/components/ui';
import { useT } from '../../src/state/lang';

export default function Password() {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Screen>
      <Title>{t('changePassword')}</Title>
      <Field label={t('currentPassword')} value={current} onChangeText={setCurrent} secureTextEntry style={{ textAlign: 'left' }} />
      <Field label={t('newPassword')} hint={t('passwordHint')} value={next} onChangeText={setNext} secureTextEntry textContentType="newPassword" style={{ textAlign: 'left' }} />
      {ok ? <Banner kind="ok">✓</Banner> : null}
      {error ? <ErrorState error={error} /> : null}
      <Button title={t('save')} disabled={!current || next.length < 10} onPress={async () => {
        setError(null);
        try {
          await api('/v1/me/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
          setOk(true);
          setCurrent('');
          setNext('');
        } catch (e) {
          setError(e);
        }
      }} />
    </Screen>
  );
}
