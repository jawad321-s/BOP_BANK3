import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseMajorToMinor, type RedemptionView, type VerificationView } from '@bitaqati/shared';
import { ApiError, api, newIdempotencyKey } from '../../../src/lib/api';
import { dateTime, ltr, money, rate } from '../../../src/lib/format';
import { AuthImage, MembershipPill } from '../../../src/components/domain';
import { Banner, Body, Button, Card, ErrorState, Field, KeyValue, Loading, Row, Screen, Subtitle, Title } from '../../../src/components/ui';
import { useLang, useT } from '../../../src/state/lang';
import { colors } from '../../../src/theme';

const FINAL = ['COMPLETED', 'CANCELLED', 'MISMATCHED', 'DECLINED'];

/**
 * Cashier flow for one verification session:
 * visual match → invoice amount → server quote → wait for customer approval → confirm once.
 * The confirmation uses an Idempotency-Key persisted per quote so a retry after a lost response can never
 * create a second redemption; on network loss we re-query the same operation instead of assuming failure.
 */
export default function VerificationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const lang = useLang();
  const qc = useQueryClient();
  const v = useQuery({
    queryKey: ['verification', id],
    queryFn: () => api<VerificationView>(`/v1/merchant/verifications/${id}`),
    refetchInterval: (q) => (q.state.data && FINAL.includes(q.state.data.status) ? false : 2000),
  });
  const [gross, setGross] = useState('');
  const [partial, setPartial] = useState(false);
  const [eligible, setEligible] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<RedemptionView | null>(null);

  useEffect(() => {
    if (v.data?.redemption) setResult(v.data.redemption);
  }, [v.data?.redemption]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await v.refetch();
    } catch (e) {
      setError(e);
      void v.refetch();
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (quoteId: string) => {
    const keyName = `bitaqati.idem.${quoteId}`;
    let key = await AsyncStorage.getItem(keyName);
    if (!key) {
      key = newIdempotencyKey();
      await AsyncStorage.setItem(keyName, key);
    }
    setBusy(true);
    setError(null);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await api<RedemptionView>('/v1/merchant/redemptions', { method: 'POST', headers: { 'Idempotency-Key': key }, body: { quoteId } });
        setResult(r);
        setChecking(false);
        await AsyncStorage.removeItem(keyName);
        void qc.invalidateQueries({ queryKey: ['merchant-dashboard'] });
        void qc.invalidateQueries({ queryKey: ['merchant-redemptions'] });
        break;
      } catch (e) {
        const retryable = e instanceof ApiError && (e.isNetwork || e.status === 503 || e.code === 'REQUEST_IN_PROGRESS');
        if (!retryable) {
          setChecking(false);
          setError(e);
          break;
        }
        setChecking(true); // same key, same operation — never a new transaction
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    setBusy(false);
    void v.refetch();
  };

  if (v.isLoading) return <Screen><Loading /></Screen>;
  if (v.error && !v.data) return <Screen><ErrorState error={v.error} onRetry={() => v.refetch()} /></Screen>;
  const d = v.data!;
  const q = d.currentQuote;
  const quoteLive = q && (q.status === 'AWAITING_APPROVAL' || q.status === 'APPROVED');

  const done = result ?? d.redemption;
  if (done)
    return (
      <Screen>
        <Stack.Screen options={{ title: t('recorded') }} />
        <Banner kind="ok">{t('recorded')} ✓</Banner>
        <Card>
          <KeyValue k={t('ref')} v={ltr(done.ref)} />
          <KeyValue k={t('invoiceTotal')} v={money(done.grossMinor, lang)} />
          <KeyValue k={`${t('discount')} (${rate(done.rateBps)})`} v={money(done.discountMinor, lang)} />
          <KeyValue k={t('toPay')} v={money(done.netMinor, lang)} strong />
          <Body muted>{dateTime(done.confirmedAt, lang, done.timezone)} · {done.businessDate}</Body>
        </Card>
        <Button title={t('newScan')} onPress={() => router.replace('/scan')} />
      </Screen>
    );

  return (
    <Screen>
      <Stack.Screen options={{ title: `${d.store.name[lang]} — ${d.branch.name[lang]}` }} />
      {d.status === 'CANCELLED' ? <Banner kind="error">⌛ {t('newScan')}</Banner> : null}
      {d.status === 'MISMATCHED' || d.status === 'DECLINED' ? <Banner kind="error">✗</Banner> : null}
      {d.status === 'AWAITING_USER' ? <Banner>{t('waitingCustomer')}</Banner> : null}

      {d.holder ? (
        <Card>
          <Row style={{ alignItems: 'flex-start' }}>
            {d.holder.photoAvailable && (d.status === 'PENDING_MATCH' || d.status === 'MATCHED') ? <AuthImage path={`/v1/merchant/verifications/${d.id}/photo`} size={140} /> : null}
            <View style={{ flex: 1, gap: 6 }}>
              <Title>{d.holder.fullName}</Title>
              <Text style={{ color: colors.muted }}>{ltr(d.holder.serialNumber)}</Text>
              {d.membershipState ? <MembershipPill state={d.membershipState} /> : null}
              {d.offer ? <Text style={{ fontSize: 22, fontWeight: '800', color: colors.emerald }}>{rate(d.offer.rateBps)}</Text> : null}
            </View>
          </Row>
          {d.alreadyRedeemedToday ? <Banner kind="warn">{t('alreadyUsedWarning')}</Banner> : null}
        </Card>
      ) : null}

      {d.status === 'PENDING_MATCH' ? (
        <>
          <Subtitle>{t('compareFace')}</Subtitle>
          <Button title={t('match')} loading={busy} onPress={() => run(() => api(`/v1/merchant/verifications/${id}/match`, { method: 'POST', body: { decision: 'MATCH' } }))} />
          <Button title={t('mismatch')} variant="danger" onPress={() => run(() => api(`/v1/merchant/verifications/${id}/match`, { method: 'POST', body: { decision: 'MISMATCH' } }))} />
        </>
      ) : null}

      {d.status === 'MATCHED' && !d.alreadyRedeemedToday && (!quoteLive || q?.status === 'AWAITING_APPROVAL') ? (
        <Card>
          <Field label={t('enterInvoice')} value={gross} onChangeText={setGross} keyboardType="decimal-pad" inputMode="decimal" style={{ textAlign: 'left', fontSize: 22 }} />
          <Button title={t('partialEligible')} variant="ghost" onPress={() => setPartial(!partial)} />
          {partial ? (
            <>
              <Field label={t('eligibleAmount')} value={eligible} onChangeText={setEligible} keyboardType="decimal-pad" style={{ textAlign: 'left' }} />
              <Field label={t('eligibleReason')} value={reason} onChangeText={setReason} />
            </>
          ) : null}
          <Button
            title={t('calculate')}
            loading={busy}
            disabled={parseMajorToMinor(gross) == null || (partial && (parseMajorToMinor(eligible) == null || reason.trim().length < 2))}
            onPress={() =>
              run(() =>
                api('/v1/merchant/quotes', {
                  method: 'POST',
                  body: { verificationId: id, grossMinor: parseMajorToMinor(gross), ...(partial ? { eligibleMinor: parseMajorToMinor(eligible), eligibleReason: reason.trim() } : {}) },
                }),
              )
            }
          />
        </Card>
      ) : null}

      {q && quoteLive ? (
        <Card>
          <KeyValue k={t('invoiceTotal')} v={money(q.grossMinor, lang)} />
          {q.eligibleMinor !== q.grossMinor ? <KeyValue k={t('eligibleAmount')} v={money(q.eligibleMinor, lang)} /> : null}
          <KeyValue k={`${t('discount')} (${rate(q.rateBps)})`} v={`− ${money(q.discountMinor, lang)}`} />
          <KeyValue k={t('toPay')} v={money(q.netMinor, lang)} strong />
          {q.status === 'AWAITING_APPROVAL' ? <Banner>{t('waitingApproval')}</Banner> : null}
          {q.status === 'APPROVED' ? <Button title={t('confirmUse')} loading={busy} onPress={() => confirm(q.id)} /> : null}
        </Card>
      ) : null}
      {q?.status === 'REJECTED' ? <Banner kind="error">{t('customerRejected')}</Banner> : null}
      {checking ? <Banner kind="warn">{t('checkingStatus')}</Banner> : null}
      {error ? <ErrorState error={error} /> : null}

      {!FINAL.includes(d.status) ? <Button title={t('cancel')} variant="secondary" onPress={() => run(() => api(`/v1/merchant/verifications/${id}/cancel`, { method: 'POST' })).then(() => router.replace('/scan'))} /> : <Button title={t('newScan')} onPress={() => router.replace('/scan')} />}
    </Screen>
  );
}
