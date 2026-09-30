import { RefreshControl } from 'react-native';
import { colors } from '../theme';

export function refreshControl(onRefresh: () => void, refreshing?: boolean) {
  return <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.navy} />;
}
