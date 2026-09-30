import { useState } from 'react';
import { router } from 'expo-router';
import { Linking, Pressable, Switch, Text, View } from 'react-native';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema } from '@bitaqati/shared';
import { z } from 'zod';
import { api } from '../../src/lib/api';
import { getLang } from '../../src/lib/i18n';
import { useConfig } from '../../src/lib/useConfig';
import { Banner, Button, ErrorState, Field, Screen, Title } from '../../src/components/ui';
import { useT } from '../../src/state/lang';
import { colors } from '../../src/theme';

type Form = z.input<typeof registerSchema>;

export default function Register() {
  const t = useT();
  const cfg = useConfig();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { control, handleSubmit, formState } = useForm<Form>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', fullName: '', locale: getLang(), acceptTerms: false as unknown as true },
  });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await api('/v1/auth/register', { method: 'POST', auth: false, body: v });
      setDone(true);
    } catch (e) {
      setError(e);
    }
  });
  if (done)
    return (
      <Screen>
        <Title>{t('signUp')}</Title>
        <Banner kind="ok">{t('checkEmail')}</Banner>
        <Button title={t('haveToken')} onPress={() => router.replace('/verify-email')} />
      </Screen>
    );
  return (
    <Screen>
      <Title>{t('signUp')}</Title>
      <Controller control={control} name="fullName" render={({ field, fieldState }) => <Field label={t('fullName')} value={field.value} onChangeText={field.onChange} autoComplete="name" textContentType="name" error={fieldState.error?.message} />} />
      <Controller control={control} name="email" render={({ field, fieldState }) => <Field label={t('email')} value={field.value} onChangeText={field.onChange} autoCapitalize="none" keyboardType="email-address" textContentType="emailAddress" error={fieldState.error?.message} style={{ textAlign: 'left' }} />} />
      <Controller control={control} name="password" render={({ field, fieldState }) => <Field label={t('password')} hint={t('passwordHint')} value={field.value} onChangeText={field.onChange} secureTextEntry textContentType="newPassword" error={fieldState.error ? t('passwordHint') : undefined} style={{ textAlign: 'left' }} />} />
      <Controller control={control} name="acceptTerms" render={({ field, fieldState }) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Switch value={!!field.value} onValueChange={(v) => field.onChange(v)} accessibilityLabel={t('acceptTerms')} trackColor={{ true: colors.emerald }} />
          <Pressable onPress={() => cfg.data?.termsUrl && Linking.openURL(cfg.data.termsUrl)} style={{ flex: 1 }} accessibilityRole="link">
            <Text style={{ color: fieldState.error ? colors.danger : colors.text, fontSize: 15 }}>{t('acceptTerms')}</Text>
          </Pressable>
        </View>
      )} />
      {error ? <ErrorState error={error} /> : null}
      <Button title={t('signUp')} onPress={onSubmit} loading={formState.isSubmitting} />
    </Screen>
  );
}
