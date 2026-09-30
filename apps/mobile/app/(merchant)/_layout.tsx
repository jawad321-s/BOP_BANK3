import { Redirect, Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useAuth, useMerchantWorkspace } from '../../src/state/auth';
import { useT } from '../../src/state/lang';
import { colors } from '../../src/theme';

function Icon({ color, glyph }: { color: import('react-native').ColorValue; glyph: string }) {
  return <Text style={{ color, fontSize: 20 }} accessible={false}>{glyph}</Text>;
}

export default function MerchantTabs() {
  const t = useT();
  const { status } = useAuth();
  const ws = useMerchantWorkspace();
  if (status === 'signedOut') return <Redirect href="/welcome" />;
  if (!ws) return <Redirect href="/home" />;
  const owner = ws.role === 'OWNER';
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.emerald, headerTitleAlign: 'center', headerTintColor: colors.navy }}>
      <Tabs.Screen name="dashboard" options={{ title: t('dashboard'), tabBarIcon: ({ color }) => <Icon color={color} glyph="▤" /> }} />
      <Tabs.Screen name="scan" options={{ title: t('scan'), tabBarIcon: ({ color }) => <Icon color={color} glyph="⌗" /> }} />
      <Tabs.Screen name="transactions" options={{ title: t('transactions'), tabBarIcon: ({ color }) => <Icon color={color} glyph="≡" /> }} />
      <Tabs.Screen name="staff" options={{ title: t('staff'), href: owner ? undefined : null, tabBarIcon: ({ color }) => <Icon color={color} glyph="☺" /> }} />
      <Tabs.Screen name="settings" options={{ title: t('settings'), tabBarIcon: ({ color }) => <Icon color={color} glyph="⚙" /> }} />
    </Tabs>
  );
}
