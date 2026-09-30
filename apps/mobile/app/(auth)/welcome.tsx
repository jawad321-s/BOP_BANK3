import { router } from 'expo-router';
import { View } from 'react-native';
import { Body, Button, Screen, Title } from '../../src/components/ui';
import { useT } from '../../src/state/lang';

export default function Welcome() {
  const t = useT();
  return (
    <Screen>
      <View style={{ gap: 12, marginTop: 48 }}>
        <Title>{t('appName')}</Title>
        <Body>{t('tagline')}</Body>
      </View>
      <View style={{ gap: 12, marginTop: 32 }}>
        <Button title={t('signIn')} onPress={() => router.push('/login')} />
        <Button title={t('signUp')} variant="secondary" onPress={() => router.push('/register')} />
        <Button title={t('browseStores')} variant="ghost" onPress={() => router.push('/browse')} />
      </View>
    </Screen>
  );
}
