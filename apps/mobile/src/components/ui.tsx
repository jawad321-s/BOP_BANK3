import { forwardRef } from 'react';
import { ActivityIndicator, I18nManager, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api';
import { refreshControl } from './refresh';
import { colors, radius, space, TOUCH } from '../theme';
import { useT } from '../state/lang';

export function Screen({ children, scroll = true, onRefresh, refreshing }: { children: React.ReactNode; scroll?: boolean; onRefresh?: () => void; refreshing?: boolean }) {
  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" refreshControl={onRefresh ? refreshControl(onRefresh, refreshing) : undefined}>
          {children}
        </ScrollView>
      ) : (
        <View style={[s.content, { flex: 1 }]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={s.title} accessibilityRole="header" maxFontSizeMultiplier={1.6}>{children}</Text>;
}

export function Subtitle({ children }: { children: React.ReactNode }) {
  return <Text style={s.subtitle} accessibilityRole="header">{children}</Text>;
}

export function Body({ children, muted, style }: { children: React.ReactNode; muted?: boolean; style?: object }) {
  return <Text style={[s.body, muted && { color: colors.muted }, style]}>{children}</Text>;
}

export function Button({ title, onPress, variant = 'primary', disabled, loading, accessibilityHint }: { title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; disabled?: boolean; loading?: boolean; accessibilityHint?: string }) {
  const style = variant === 'primary' ? s.btnPrimary : variant === 'danger' ? s.btnDanger : variant === 'ghost' ? s.btnGhost : s.btnSecondary;
  const textStyle = variant === 'secondary' || variant === 'ghost' ? { color: colors.navy } : { color: '#fff' };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      accessibilityHint={accessibilityHint}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [s.btn, style, (disabled || loading) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
    >
      {loading ? <ActivityIndicator color={variant === 'secondary' ? colors.navy : '#fff'} /> : <Text style={[s.btnText, textStyle]}>{title}</Text>}
    </Pressable>
  );
}

export const Field = forwardRef<TextInput, TextInputProps & { label: string; error?: string; hint?: string }>(function Field({ label, error, hint, style, ...props }, ref) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput ref={ref} accessibilityLabel={label} placeholderTextColor={colors.muted} style={[s.input, error ? { borderColor: colors.danger } : null, style]} {...props} />
      {hint && !error ? <Text style={s.hint}>{hint}</Text> : null}
      {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
});

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Banner({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error' | 'ok'; children: React.ReactNode }) {
  const bg = kind === 'warn' ? colors.warningLight : kind === 'error' ? colors.dangerLight : kind === 'ok' ? colors.emeraldLight : colors.info;
  const fg = kind === 'warn' ? colors.warning : kind === 'error' ? colors.danger : kind === 'ok' ? '#0B6B52' : colors.navy;
  return (
    <View style={[s.banner, { backgroundColor: bg }]} accessibilityRole={kind === 'error' ? 'alert' : undefined}>
      <Text style={{ color: fg, fontSize: 15, textAlign: 'auto' }}>{children}</Text>
    </View>
  );
}

export function Loading() {
  const t = useT();
  return (
    <View style={s.center} accessibilityLabel={t('loading')}>
      <ActivityIndicator color={colors.navy} />
    </View>
  );
}

export function Empty({ text }: { text?: string }) {
  const t = useT();
  return <Body muted>{text ?? t('empty')}</Body>;
}

/** Loading / offline / error states in one place. Never shows backend jargon or stack traces. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const net = error instanceof ApiError && error.isNetwork;
  const msg = net ? t('offline') : error instanceof ApiError && error.message ? error.message : t('retry');
  return (
    <View style={{ gap: space(3) }}>
      <Banner kind={net ? 'warn' : 'error'}>{msg}</Banner>
      {onRetry ? <Button title={t('retry')} variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space(2), flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Pill({ text, tone = 'neutral' }: { text: string; tone?: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  const bg = tone === 'ok' ? colors.emeraldLight : tone === 'warn' ? colors.warningLight : tone === 'bad' ? colors.dangerLight : '#EEF2F7';
  const fg = tone === 'ok' ? '#0B6B52' : tone === 'warn' ? colors.warning : tone === 'bad' ? colors.danger : colors.navy;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontSize: 13, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

export function KeyValue({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
      <Text style={s.body}>{k}</Text>
      <Text style={[s.body, strong && { fontWeight: '700', fontSize: 18, color: colors.navy }]}>{v}</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), gap: space(3), paddingBottom: space(10) },
  title: { fontSize: 26, fontWeight: '700', color: colors.navy, textAlign: 'auto' },
  subtitle: { fontSize: 18, fontWeight: '700', color: colors.navy, marginTop: space(2), textAlign: 'auto' },
  body: { fontSize: 16, color: colors.text, textAlign: 'auto', lineHeight: 22 },
  label: { fontSize: 14, color: colors.muted, textAlign: 'auto' },
  hint: { fontSize: 13, color: colors.muted, textAlign: 'auto' },
  error: { fontSize: 13, color: colors.danger, textAlign: 'auto' },
  input: { minHeight: TOUCH, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: space(3), fontSize: 17, backgroundColor: colors.surface, color: colors.text, textAlign: I18nManager.isRTL ? 'right' : 'left', writingDirection: 'auto' },
  btn: { minHeight: TOUCH, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space(4) },
  btnPrimary: { backgroundColor: colors.navy },
  btnSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.navy },
  btnDanger: { backgroundColor: colors.danger },
  btnGhost: { backgroundColor: 'transparent' },
  btnText: { fontSize: 17, fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space(4), gap: space(2) },
  banner: { borderRadius: radius.sm, padding: space(3) },
  center: { padding: space(6), alignItems: 'center' },
});
