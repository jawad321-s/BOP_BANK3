import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type { MembershipState, StoreAvailability, StoreSummary } from '@bitaqati/shared';
import { authHeader } from '../lib/api';
import { API_URL } from '../lib/config';
import { dateOnly, ltr, rate } from '../lib/format';
import { colors, radius, space } from '../theme';
import { useLang, useT } from '../state/lang';
import { Pill } from './ui';

export function MembershipPill({ state }: { state: MembershipState }) {
  const t = useT();
  const tone = state === 'ACTIVE' ? 'ok' : state === 'PENDING_ACTIVATION' || state === 'PHOTO_PENDING' ? 'warn' : 'bad';
  return <Pill text={t(`state_${state}` as never)} tone={tone} />;
}

export function AvailabilityPill({ value }: { value: StoreAvailability }) {
  const t = useT();
  const tone = value === 'AVAILABLE' ? 'ok' : value === 'USED_TODAY' || value === 'CLOSED_NOW' ? 'warn' : value === 'SIGNED_OUT' ? 'neutral' : 'bad';
  return <Pill text={t(`avail_${value}` as never)} tone={tone} />;
}

export function StoreRow({ store, onPress, extra }: { store: StoreSummary & { distanceKm?: number | null }; onPress: () => void; extra?: string }) {
  const lang = useLang();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${store.name[lang]} ${rate(store.rateBps)}`} style={({ pressed }) => [st.row, pressed && { opacity: 0.8 }]}>
      {store.logoUrl ? <Image source={{ uri: store.logoUrl }} style={st.logo} accessibilityIgnoresInvertColors /> : <View style={[st.logo, { backgroundColor: colors.emeraldLight }]} />}
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={st.name}>{store.name[lang]}</Text>
        <Text style={st.meta}>{[store.category?.name[lang], store.cities.join('، '), store.distanceKm != null ? `${store.distanceKm} km` : null].filter(Boolean).join(' · ')}</Text>
        <AvailabilityPill value={store.availability} />
        {extra ? <Text style={st.meta}>{extra}</Text> : null}
      </View>
      <Text style={st.rate}>{rate(store.rateBps)}</Text>
    </Pressable>
  );
}

/** Photo fetched with the bearer token (profile photos are never public URLs). */
export function AuthImage({ path, size = 96 }: { path: string; size?: number }) {
  return <Image source={{ uri: `${API_URL}${path}`, headers: authHeader(), cache: 'reload' }} style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: '#EEF2F7' }} accessibilityIgnoresInvertColors />;
}

export function DigitalCard({ name, serial, state, endsAt, photoPath, qrPayload }: { name: string; serial: string | null; state: MembershipState; endsAt: string | null; photoPath: string | null; qrPayload?: string | null }) {
  const t = useT();
  const lang = useLang();
  return (
    <View style={st.card} accessible accessibilityLabel={`${t('myCard')}: ${name}, ${t(`state_${state}` as never)}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={st.brand}>{t('appName')}</Text>
        <MembershipPill state={state} />
      </View>
      <View style={{ flexDirection: 'row', gap: space(3), alignItems: 'center' }}>
        {photoPath ? <AuthImage path={photoPath} size={72} /> : <View style={[st.photoPh]} />}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={st.holder} numberOfLines={2}>{name}</Text>
          {serial ? <Text style={st.serial} accessibilityLabel={`${t('serial')} ${serial}`}>{ltr(serial)}</Text> : null}
          {endsAt ? <Text style={st.ends}>{t('endsOn')} {dateOnly(endsAt, lang)}</Text> : null}
        </View>
      </View>
      {qrPayload ? (
        <View style={st.qrBox} accessibilityLabel={t('showToCashier')}>
          <QRCode value={qrPayload} size={210} ecl="M" backgroundColor="#FFFFFF" color={colors.navy} />
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', gap: space(3), alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space(3) },
  logo: { width: 52, height: 52, borderRadius: radius.sm },
  name: { fontSize: 17, fontWeight: '700', color: colors.text, textAlign: 'auto' },
  meta: { fontSize: 13, color: colors.muted, textAlign: 'auto' },
  rate: { fontSize: 22, fontWeight: '800', color: colors.emerald },
  card: { backgroundColor: colors.navy, borderRadius: radius.lg, padding: space(5), gap: space(4) },
  brand: { color: '#fff', fontSize: 18, fontWeight: '800' },
  holder: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'auto' },
  serial: { color: '#CFE3F7', fontSize: 15, fontFamily: 'Menlo', letterSpacing: 1, textAlign: 'auto' },
  ends: { color: '#CFE3F7', fontSize: 13, textAlign: 'auto' },
  photoPh: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.navy2 },
  qrBox: { backgroundColor: '#fff', borderRadius: radius.md, padding: space(4), alignItems: 'center', alignSelf: 'center' },
});
