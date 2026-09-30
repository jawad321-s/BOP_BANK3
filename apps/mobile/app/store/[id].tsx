import { Image, Linking, Platform, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { StoreDetail } from '@bitaqati/shared';
import { api } from '../../src/lib/api';
import { money, rate } from '../../src/lib/format';
import { AvailabilityPill } from '../../src/components/domain';
import { Body, Button, Card, ErrorState, Loading, Pill, Row, Screen, Subtitle, Title } from '../../src/components/ui';
import { useAuth } from '../../src/state/auth';
import { useLang, useT } from '../../src/state/lang';
import { colors } from '../../src/theme';

export default function StoreDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const lang = useLang();
  const { status } = useAuth();
  const q = useQuery({ queryKey: ['store', id, status], queryFn: () => api<StoreDetail>(`/v1/stores/${id}`, { auth: status === 'signedIn' }) });
  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.error) return <Screen><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const s = q.data!;
  const openMaps = (lat: number, lng: number, label: string) =>
    Linking.openURL(Platform.OS === 'ios' ? `http://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(label)}` : `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`);
  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <Stack.Screen options={{ title: s.name[lang] }} />
      {s.images.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {s.images.map((u) => <Image key={u} source={{ uri: u }} style={{ width: 260, height: 160, borderRadius: 12 }} accessibilityIgnoresInvertColors />)}
        </ScrollView>
      ) : null}
      <Row style={{ justifyContent: 'space-between' }}>
        <Title>{s.name[lang]}</Title>
        <Text style={{ fontSize: 28, fontWeight: '800', color: colors.emerald }}>{rate(s.rateBps)}</Text>
      </Row>
      <Row>
        <AvailabilityPill value={s.availability} />
        {s.category ? <Pill text={s.category.name[lang]} /> : null}
      </Row>
      {s.description[lang] ? <Body>{s.description[lang]}</Body> : null}
      {s.offer ? (
        <Card>
          <Subtitle>{t('offerTerms')}</Subtitle>
          {s.offer.maxDiscountMinor ? <Body>{t('maxDiscount')}: {money(s.offer.maxDiscountMinor, lang)}</Body> : null}
          {s.offer.minEligibleMinor ? <Body>{t('minPurchase')}: {money(s.offer.minEligibleMinor, lang)}</Body> : null}
          {s.offer.terms[lang] ? <Body muted>{s.offer.terms[lang]}</Body> : null}
        </Card>
      ) : null}
      {s.phone ? <Button title={`${t('call')} ${s.phone}`} variant="secondary" onPress={() => Linking.openURL(`tel:${s.phone}`)} /> : null}
      {s.branches.map((b) => (
        <Card key={b.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Subtitle>{b.name[lang]}</Subtitle>
            {b.openNow === false ? <Pill text={t('avail_CLOSED_NOW')} tone="warn" /> : null}
          </Row>
          <Body muted>{b.city}{b.address[lang] ? ` — ${b.address[lang]}` : ''}</Body>
          {b.openingHours.length > 0 ? (
            <View>
              <Text style={{ color: colors.muted, marginTop: 4 }}>{t('openingHours')}</Text>
              {b.openingHours.map((h, i) => <Text key={i} style={{ color: colors.text }}>{t(`weekday_${h.day}` as never)} {h.open}–{h.close}</Text>)}
            </View>
          ) : null}
          {b.lat != null && b.lng != null ? <Button title={t('directions')} variant="secondary" onPress={() => openMaps(b.lat!, b.lng!, b.name[lang])} /> : null}
          {b.phone ? <Button title={`${t('call')} ${b.phone}`} variant="ghost" onPress={() => Linking.openURL(`tel:${b.phone}`)} /> : null}
        </Card>
      ))}
    </Screen>
  );
}
