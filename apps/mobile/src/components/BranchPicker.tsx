import { Pressable, Text, View } from 'react-native';
import { colors, radius } from '../theme';
import { useLang, useT } from '../state/lang';

export function BranchPicker({ branches, value, onChange, allowAll }: { branches: Array<{ id: string; name: { ar: string; en: string }; storeName: { ar: string; en: string } }>; value: string | null; onChange: (id: string | null) => void; allowAll?: boolean }) {
  const t = useT();
  const lang = useLang();
  const opts = [...(allowAll ? [{ id: null as string | null, label: '∗' }] : []), ...branches.map((b) => ({ id: b.id as string | null, label: `${b.storeName[lang]} — ${b.name[lang]}` }))];
  return (
    <View style={{ gap: 6 }} accessibilityLabel={t('chooseBranch')}>
      <Text style={{ color: colors.muted }}>{t('branch')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {opts.map((o) => (
          <Pressable key={String(o.id)} onPress={() => onChange(o.id)} accessibilityRole="radio" accessibilityState={{ checked: value === o.id }} style={{ paddingHorizontal: 12, minHeight: 40, justifyContent: 'center', borderRadius: radius.sm, borderWidth: 1, borderColor: value === o.id ? colors.emerald : colors.border, backgroundColor: value === o.id ? colors.emeraldLight : colors.surface }}>
            <Text style={{ color: colors.navy }}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
