import { useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ApiError, api } from '../../src/lib/api';
import { Button, ErrorState, Field, Screen, Title } from '../../src/components/ui';
import { useAuth } from '../../src/state/auth';
import { useT } from '../../src/state/lang';

const schema = z.object({ email: z.string().trim().email(), password: z.string().min(1) });

export default function Login() {
  const t = useT();
  const { signIn } = useAuth();
  const [error, setError] = useState<unknown>(null);
  const [unverified, setUnverified] = useState(false);
  const { control, handleSubmit, formState, getValues } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    setUnverified(false);
    try {
      await signIn(v.email, v.password);
      router.replace('/');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'EMAIL_NOT_VERIFIED') setUnverified(true);
      setError(e);
    }
  });
  return (
    <Screen>
      <Title>{t('signIn')}</Title>
      <Controller control={control} name="email" render={({ field, fieldState }) => (
        <Field label={t('email')} value={field.value} onChangeText={field.onChange} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" error={fieldState.error ? ' ' : undefined} style={{ textAlign: 'left' }} />
      )} />
      <Controller control={control} name="password" render={({ field }) => (
        <Field label={t('password')} value={field.value} onChangeText={field.onChange} secureTextEntry autoComplete="current-password" textContentType="password" style={{ textAlign: 'left' }} />
      )} />
      {error ? <ErrorState error={error} /> : null}
      {unverified ? (
        <Button title={t('resendVerification')} variant="secondary" onPress={() => api('/v1/auth/verify-email/resend', { method: 'POST', auth: false, body: { email: getValues('email') } }).then(() => router.push('/verify-email'))} />
      ) : null}
      <Button title={t('signIn')} onPress={onSubmit} loading={formState.isSubmitting} />
      <View style={{ gap: 8 }}>
        <Button title={t('forgotPassword')} variant="ghost" onPress={() => router.push('/forgot')} />
        <Button title={t('haveToken')} variant="ghost" onPress={() => router.push('/verify-email')} />
      </View>
    </Screen>
  );
}

