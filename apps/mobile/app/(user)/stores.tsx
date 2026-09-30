import { SafeAreaView } from 'react-native-safe-area-context';
import { StoresList } from '../../src/components/StoresList';
import { colors } from '../../src/theme';

export default function Stores() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['left', 'right']}>
      <StoresList />
    </SafeAreaView>
  );
}
