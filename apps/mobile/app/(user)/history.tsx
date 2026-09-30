import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { Paginated, RedemptionView } from '@bitaqati/shared';
import { api } from '../../src/lib/api';
import { dateTime, ltr, money, rate } from '../../src/lib/format';
import { Card, Empty, ErrorState, KeyValue, Loading, Pill, Row } from '../../src/components/ui';
import { useLang, useT } from '../../src/state/lang';
import { colors } from '../../src/theme';

const RANGES = [7, 30, 365] as const;

export default function History() {
  const t = useT();
  const lang = useLang();
  const [days, setDays] = useState<number | null>(null);
  const from = days ? new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10) : null;
  const q = useInfiniteQuery({
    queryKey: ['usage', from],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<Paginated<RedemptionView>>(`/v1/me/usage?limit=20${from ? `&from=${from}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
      data={items}
      keyExtractor={(r) => r.id}
      onRefresh={() => q.refetch()}
      refreshing={q.isRefetching}
      onEndReached={() => q.hasNextPage && q.fetchNextPage()}
      ListHeaderComponent={
        <View style={{ gap: 8 }}>
          <Row>
            {[null, ...RANGES].map((d) => (
              <Text key={String(d)} onPress={() => setDays(d)} accessibilityRole="button" accessibilityState={{ selected: days === d }} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, overflow: 'hidden', backgroundColor: days === d ? colors.emeraldLight : colors.surface, color: colors.navy }}>
                {d == null ? '∞' : `${d}d`}
              </Text>
            ))}
          </Row>
          {q.isLoading ? <Loading /> : null}
          {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
          {!q.isLoading && items.length === 0 ? <Empty /> : null}
        </View>
      }
      renderItem={({ item: r }) => (
        <Card style={r.status === 'VOIDED' ? { opacity: 0.75 } : undefined}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>{r.store.name[lang]}</Text>
            <Pill text={r.status === 'VOIDED' ? t('voided') : t('confirmed')} tone={r.status === 'VOIDED' ? 'bad' : 'ok'} />
          </Row>
          <Text style={{ color: colors.muted }}>{r.branch.name[lang]} · {dateTime(r.confirmedAt, lang, r.timezone)}</Text>
          <KeyValue k={t('invoiceTotal')} v={money(r.grossMinor, lang)} />
          {r.eligibleMinor !== r.grossMinor ? <KeyValue k={t('eligibleAmount')} v={money(r.eligibleMinor, lang)} /> : null}
          <KeyValue k={`${t('discount')} (${rate(r.rateBps)})`} v={money(r.discountMinor, lang)} />
          <KeyValue k={t('toPay')} v={money(r.netMinor, lang)} />
          <KeyValue k={t('ref')} v={ltr(r.ref)} />
          {r.status === 'VOIDED' ? <Text style={{ color: colors.danger }}>{t('voidReason')}: {r.voidReason} ({r.voidedAt ? dateTime(r.voidedAt, lang, r.timezone) : ''})</Text> : null}
        </Card>
      )}
    />
  );
}
