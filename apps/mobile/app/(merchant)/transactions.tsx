import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { Paginated, RedemptionView } from '@bitaqati/shared';
import { api } from '../../src/lib/api';
import { dateTime, ltr, money, rate } from '../../src/lib/format';
import { BranchPicker } from '../../src/components/BranchPicker';
import { Card, Empty, ErrorState, Loading, Pill, Row } from '../../src/components/ui';
import { useBranch } from '../../src/state/branch';
import { useLang, useT } from '../../src/state/lang';
import { colors } from '../../src/theme';

export default function Transactions() {
  const t = useT();
  const lang = useLang();
  const { branches } = useBranch();
  const [branchId, setBranchId] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['merchant-redemptions', branchId],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<Paginated<RedemptionView>>(`/v1/merchant/redemptions?limit=25${branchId ? `&branchId=${branchId}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`),
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
        <View style={{ gap: 10 }}>
          <BranchPicker branches={branches} value={branchId} onChange={setBranchId} allowAll />
          {q.isLoading ? <Loading /> : null}
          {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
          {!q.isLoading && items.length === 0 ? <Empty /> : null}
        </View>
      }
      renderItem={({ item: r }) => (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>{r.customerName} · {ltr(r.ref)}</Text>
            <Pill text={r.status === 'VOIDED' ? t('voided') : t('confirmed')} tone={r.status === 'VOIDED' ? 'bad' : 'ok'} />
          </Row>
          <Text style={{ color: colors.muted }}>{r.branch.name[lang]} · {r.staffName} · {dateTime(r.confirmedAt, lang, r.timezone)}</Text>
          <Text style={{ color: colors.text }}>{money(r.grossMinor, lang)} − {money(r.discountMinor, lang)} ({rate(r.rateBps)}) = {money(r.netMinor, lang)}</Text>
        </Card>
      )}
    />
  );
}
