import { useEffect, useState } from 'react';
import { Linking, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { enablePush, pushStatus } from '../../src/lib/push';
import { Banner, Body, Button, Card, Screen, Subtitle, Title } from '../../src/components/ui';
import { useAuth } from '../../src/state/auth';
import { useT } from '../../src/state/lang';
import { colors } from '../../src/theme';
import { CARD_LOCK_KEY } from '../../src/lib/keys';
import { AccountActions } from '../../src/components/AccountActions';

interface Prefs { marketing: boolean; dailySummary: boolean; expiryReminders: boolean }

function Toggle({ label, value, onChange, help }: { label: string; value: boolean; onChange: (v: boolean) => void; help?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, color: colors.text }}>{label}</Text>
        {help ? <Text style={{ fontSize: 12, color: colors.muted }}>{help}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} trackColor={{ true: colors.emerald }} />
    </View>
  );
}

export default function Account() {
  const t = useT();
  const { me } = useAuth();
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ['prefs'], queryFn: () => api<Prefs>('/v1/me/notification-preferences') });
  const [push, setPush] = useState<string>('undetermined');
  const [lock, setLock] = useState(false);
  useEffect(() => {
    pushStatus().then(setPush).catch(() => undefined);
    AsyncStorage.getItem(CARD_LOCK_KEY).then((v) => setLock(v === '1'));
  }, []);
  const update = async (patch: Partial<Prefs>) => {
    qc.setQueryData(['prefs'], { ...prefs.data, ...patch });
    await api('/v1/me/notification-preferences', { method: 'PATCH', body: patch });
    void prefs.refetch();
  };
  return (
    <Screen>
      <Title>{me?.fullName}</Title>
      <Body muted>{me?.email}</Body>
      <Card>
        <Button title={t('profile')} variant="ghost" onPress={() => router.push('/me/profile')} />
        <Button title={t('uploadPhoto')} variant="ghost" onPress={() => router.push('/me/photo')} />
        <Button title={t('notificationCenter')} variant="ghost" onPress={() => router.push('/me/notifications')} />
        <Button title={t('devices')} variant="ghost" onPress={() => router.push('/me/devices')} />
        <Button title={t('changePassword')} variant="ghost" onPress={() => router.push('/me/password')} />
      </Card>
      <Card>
        <Subtitle>{t('notifications')}</Subtitle>
        {push !== 'granted' ? <Button title={t('enablePush')} variant="secondary" onPress={async () => setPush(await enablePush())} /> : null}
        {push === 'denied' ? (
          <>
            <Banner kind="warn">{t('pushDenied')}</Banner>
            <Button title={t('openSettings')} variant="ghost" onPress={() => Linking.openSettings()} />
          </>
        ) : null}
        {prefs.data ? (
          <>
            <Toggle label={t('expiryReminders')} value={prefs.data.expiryReminders} onChange={(v) => update({ expiryReminders: v })} />
            <Toggle label={t('dailySummary')} value={prefs.data.dailySummary} onChange={(v) => update({ dailySummary: v })} />
            <Toggle label={t('marketing')} value={prefs.data.marketing} onChange={(v) => update({ marketing: v })} />
          </>
        ) : null}
      </Card>
      <Card>
        <Toggle label={t('cardLock')} help={t('cardLockHelp')} value={lock} onChange={async (v) => { setLock(v); await AsyncStorage.setItem(CARD_LOCK_KEY, v ? '1' : '0'); }} />
      </Card>
      <AccountActions />
      <Button title={t('deleteAccount')} variant="danger" onPress={() => router.push('/me/delete')} />
    </Screen>
  );
}
