import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import type { HomeResponse } from '@bitaqati/shared';
import { api } from '../../src/lib/api';
import { dateOnly, money, timeOnly } from '../../src/lib/format';
import { useDayRollover } from '../../src/lib/hooks';
import { MembershipPill, StoreRow } from '../../src/components/domain';
import { Banner, Body, Card, Empty, ErrorState, Loading, Row, Screen, Subtitle, Title } from '../../src/components/ui';
import { useLang, useT } from '../../src/state/lang';
import { colors } from '../../src/theme';

const KEYS = [['home'], ['stores'], ['card']];

export default function Home() {
  const t = useT();
  const lang = useLang();
  const q = useQuery({ queryKey: ['home'], queryFn: () => api<HomeResponse>('/v1/me/home') });
  useDayRollover(q.data?.nextResetAt, KEYS);
  if (q.isLoading) return <Screen><Loading /></Screen>;
  if (q.error && !q.data) return <Screen><ErrorState error={q.error} onRetry={() => q.refetch()} /></Screen>;
  const h = q.data!;
  const m = h.membership;
  const tz = h.timezone;
  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      {q.error ? <ErrorState error={q.error} /> : null}
      <Title>{h.fullName}</Title>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 16, color: colors.muted }}>{t('membership')}</Text>
          <MembershipPill state={m.state} />
        </Row>
        {m.subscriptionEndsAt ? (
          <Body>
            {t('endsOn')} {dateOnly(m.subscriptionEndsAt, lang, tz)} · {m.daysRemaining} {t('daysLeft')}
          </Body>
        ) : null}
        {m.daysRemaining != null ? <Body muted style={{ fontSize: 12 }}>{t('daysLeftHelp')}</Body> : null}
        {m.state !== 'ACTIVE' ? <Banner kind="warn">{t(`state_${m.state}` as never)}</Banner> : null}
      </Card>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Stat label={t('storesUsed')} value={String(h.stats.distinctStoresUsed)} />
        <Stat label={t('totalUses')} value={String(h.stats.totalRedemptions)} />
        <Stat label={t('todayUses')} value={String(h.stats.todayRedemptions)} />
        <Stat label={t('totalSavings')} value={money(h.stats.totalSavingsMinor, lang)} />
      </View>

      {h.usedToday.length > 0 ? (
        <>
          <Subtitle>{t('usedToday')}</Subtitle>
          <Body muted>{t('againTomorrow')} — {t('resetsAt')} {timeOnly(h.nextResetAt, lang, tz)}</Body>
          {h.usedToday.map((s) => (
            <StoreRow key={s.id} store={s} onPress={() => router.push(`/store/${s.id}`)} extra={`${timeOnly(s.redeemedAt, lang, tz)} · ${s.redemptionRef}`} />
          ))}
        </>
      ) : null}

      <Subtitle>{t('availableToday')}</Subtitle>
      {m.state !== 'ACTIVE' ? <Body muted>{t(`state_${m.state}` as never)}</Body> : h.availableToday.length === 0 ? <Empty /> : null}
      {h.availableToday.map((s) => (
        <StoreRow key={s.id} store={s} onPress={() => router.push(`/store/${s.id}`)} />
      ))}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card style={{ flexBasis: '47%', flexGrow: 1 }}>
      <Text style={{ color: colors.muted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: colors.navy, fontSize: 22, fontWeight: '800' }} adjustsFontSizeToFit numberOfLines={1}>{value}</Text>
    </Card>
  );
}
