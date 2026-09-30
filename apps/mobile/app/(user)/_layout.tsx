import { useEffect } from 'react';
import { AppState, Text } from 'react-native';
import { Redirect, Tabs, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { QuoteView } from '@bitaqati/shared';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/state/auth';
import { useT } from '../../src/state/lang';
import { colors } from '../../src/theme';

/** Watches for approval / verification requests and opens the approval sheet. Push is a bonus, never required. */
function PendingWatcher() {
  const approvals = useQuery({ queryKey: ['approvals'], queryFn: () => api<QuoteView[]>('/v1/me/approvals/pending'), refetchInterval: () => (AppState.currentState === 'active' ? 4000 : false) });
  const requests = useQuery({ queryKey: ['verification-requests'], queryFn: () => api<Array<{ id: string }>>('/v1/me/verification-requests'), refetchInterval: () => (AppState.currentState === 'active' ? 4000 : false) });
  const count = (approvals.data?.length ?? 0) + (requests.data?.length ?? 0);
  useEffect(() => {
    if (count > 0) router.push('/approval');
  }, [count]);
  return null;
}

export default function UserTabs() {
  const t = useT();
  const { status } = useAuth();
  if (status === 'signedOut') return <Redirect href="/welcome" />;
  return (
    <>
      <PendingWatcher />
      <Tabs screenOptions={{ tabBarActiveTintColor: colors.emerald, tabBarInactiveTintColor: colors.muted, headerTitleAlign: 'center', headerTintColor: colors.navy, tabBarLabelStyle: { fontSize: 12 } }}>
        <Tabs.Screen name="home" options={{ title: t('home'), tabBarAccessibilityLabel: t('home'), tabBarIcon: ({ color }) => <TabIcon color={color} glyph="⌂" /> }} />
        <Tabs.Screen name="stores" options={{ title: t('stores'), tabBarIcon: ({ color }) => <TabIcon color={color} glyph="☷" /> }} />
        <Tabs.Screen name="card" options={{ title: t('myCard'), tabBarIcon: ({ color }) => <TabIcon color={color} glyph="▣" /> }} />
        <Tabs.Screen name="history" options={{ title: t('history'), tabBarIcon: ({ color }) => <TabIcon color={color} glyph="≡" /> }} />
        <Tabs.Screen name="account" options={{ title: t('account'), tabBarIcon: ({ color }) => <TabIcon color={color} glyph="◉" /> }} />
      </Tabs>
    </>
  );
}

function TabIcon({ color, glyph }: { color: import('react-native').ColorValue; glyph: string }) {
  return <Text style={{ color, fontSize: 20 }} accessible={false}>{glyph}</Text>;
}
