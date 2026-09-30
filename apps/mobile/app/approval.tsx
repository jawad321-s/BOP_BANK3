import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { QuoteView } from '@bitaqati/shared';
import { api } from '../src/lib/api';
import { money, rate } from '../src/lib/format';
import { Banner, Body, Button, Card, ErrorState, KeyValue, Screen, Subtitle, Title } from '../src/components/ui';
import { useLang, useT } from '../src/state/lang';

/**
 * Customer approval of the exact server-computed quote (bound by fingerprint). Any change by the store creates
 * a new quote that must be approved again.
 */
export default function Approval() {
  const t = useT();
  const lang = useLang();
  const qc = useQueryClient();
  const approvals = useQuery({ queryKey: ['approvals'], queryFn: () => api<QuoteView[]>('/v1/me/approvals/pending'), refetchInterval: 3000 });
  const requests = useQuery({ queryKey: ['verification-requests'], queryFn: () => api<Array<{ id: string; store: { name: { ar: string; en: string } }; branch: { name: { ar: string; en: string } } }>>('/v1/me/verification-requests'), refetchInterval: 3000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [approved, setApproved] = useState(false);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['approvals'] });
      await qc.invalidateQueries({ queryKey: ['verification-requests'] });
      await qc.invalidateQueries({ queryKey: ['home'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const nothing = !approvals.isLoading && !requests.isLoading && !approvals.data?.length && !requests.data?.length;
  return (
    <Screen>
      {requests.data?.map((r) => (
        <Card key={r.id}>
          <Title>{t('verifyRequestTitle')}</Title>
          <Subtitle>{r.store.name[lang]} — {r.branch.name[lang]}</Subtitle>
          <Banner kind="warn">{t('verifyRequestBody')}</Banner>
          <Button title={t('accept')} loading={busy === r.id} onPress={() => act(r.id, () => api(`/v1/me/verification-requests/${r.id}/accept`, { method: 'POST' }))} />
          <Button title={t('decline')} variant="secondary" onPress={() => act(r.id, () => api(`/v1/me/verification-requests/${r.id}/decline`, { method: 'POST' }))} />
        </Card>
      ))}
      {approvals.data?.map((q) => (
        <Card key={q.id}>
          <Title>{t('approveTitle')}</Title>
          <Subtitle>{q.store.name[lang]} — {q.branch.name[lang]}</Subtitle>
          <KeyValue k={t('invoiceTotal')} v={money(q.grossMinor, lang)} />
          {q.eligibleMinor !== q.grossMinor ? <KeyValue k={t('eligibleAmount')} v={money(q.eligibleMinor, lang)} /> : null}
          {q.eligibleReason ? <Body muted>{q.eligibleReason}</Body> : null}
          <KeyValue k={`${t('discount')} (${rate(q.rateBps)})`} v={`− ${money(q.discountMinor, lang)}`} />
          <KeyValue k={t('toPay')} v={money(q.netMinor, lang)} strong />
          {q.terms[lang] ? <Body muted>{q.terms[lang]}</Body> : null}
          <View style={{ gap: 8, marginTop: 8 }}>
            <Button title={t('approve')} loading={busy === q.id} onPress={() => act(q.id, async () => {
              await api(`/v1/me/approvals/${q.id}/approve`, { method: 'POST', body: { fingerprint: q.fingerprint } });
              setApproved(true);
            })} />
            <Button title={t('reject')} variant="secondary" onPress={() => act(q.id, () => api(`/v1/me/approvals/${q.id}/reject`, { method: 'POST', body: { fingerprint: q.fingerprint } }))} />
          </View>
        </Card>
      ))}
      {error ? <ErrorState error={error} /> : null}
      {approved ? <Banner kind="ok">{t('approvedWaiting')}</Banner> : null}
      {nothing ? <Button title="✓" variant="secondary" onPress={() => router.back()} /> : null}
    </Screen>
  );
}
