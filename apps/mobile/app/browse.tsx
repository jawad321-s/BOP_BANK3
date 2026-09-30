import { Stack } from 'expo-router';
import { StoresList } from '../src/components/StoresList';
import { useT } from '../src/state/lang';

export default function Browse() {
  const t = useT();
  return (
    <>
      <Stack.Screen options={{ title: t('stores') }} />
      <StoresList />
    </>
  );
}
