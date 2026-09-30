import { useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { MerchantDashboard } from '@bitaqati/shared';
import { api } from '../../src/lib/api';
import { money } from '../../src/lib/format';
import { BranchPicker } from '../../src/components/BranchPicker';
import { Body, Card, ErrorState, Loading, Row, Screen, Subtitle, Title } from '../../src/components/ui';
import { useBranch } from '../../src/state/branch';
import { useLang, useT } from '../../src/state/lang';
import { colors } from '../../src/theme';

const PERIODS = ['today', 'week', 'month', 'year'] as const;

export default function Dashboard() {
  const t = useT();
  const lang = useLang();
  const { ws, branches } = useBranch();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('today');
  const [branchId, setBranchId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['merchant-dashboard', period, branchId],
    queryFn: () => api<MerchantDashboard>(`/v1/merchant/dashboard?period=${period}${branchId ? `&branchId=${branchId}` : ''}`),
    refetchInterval: 30_000,
  });
  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <Title>{ws?.merchantName[lang]}</Title>
      <BranchPicker branches={branches} value={branchId} onChange={setBranchId} allowAll />
      <Row>
        {PERIODS.map((p) => (
          <Text key={p} onPress={() => setPeriod(p)} accessibilityRole="button" accessibilityState={{ selected: period === p }} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, overflow: 'hidden', backgroundColor: period === p ? colors.emeraldLight : colors.surface, color: colors.navy }}>
            {t(`period_${p}` as never)}
          </Text>
        ))}
      </Row>
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Kpi label={`${t('distinctCustomers')} (${t('period_today')})`} value={String(q.data.distinctCustomersToday)} />
            <Kpi label={`${t('transactions')} (${t('period_today')})`} value={String(q.data.redemptionsToday)} />
            <Kpi label={t('distinctCustomers')} value={String(q.data.distinctCustomers)} />
            <Kpi label={t('transactions')} value={String(q.data.redemptions)} />
          </View>
          <Card>
            <Subtitle>{t('recordedAmounts')}</Subtitle>
            <Body>{t('grossTotal')}: {money(q.data.grossMinor, lang)}</Body>
            <Body>{t('discountTotal')}: {money(q.data.discountMinor, lang)}</Body>
            <Body>{t('netTotal')}: {money(q.data.netMinor, lang)}</Body>
            <Body muted>{q.data.period.from} → {q.data.period.to} · {q.data.timezone}</Body>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card style={{ flexBasis: '47%', flexGrow: 1 }}>
      <Text style={{ color: colors.muted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: colors.navy, fontSize: 24, fontWeight: '800' }}>{value}</Text>
    </Card>
  );
}
