import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useQuery, onlineManager } from '@tanstack/react-query';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CardResponse, QrTokenResponse } from '@bitaqati/shared';
import { ApiError, api } from '../../src/lib/api';
import { useConfig } from '../../src/lib/useConfig';
import { DigitalCard } from '../../src/components/domain';
import { Banner, Button, ErrorState, Loading, Screen } from '../../src/components/ui';
import { useT } from '../../src/state/lang';
import { CARD_LOCK_KEY } from '../../src/lib/keys';
import { colors } from '../../src/theme';


/**
 * Card with a server-issued, short-lived QR. The QR is fetched only while the screen is focused and the app
 * active; it is never cached or shown offline, and is hidden for inactive memberships.
 */
export default function CardScreen() {
  const t = useT();
  const cfg = useConfig();
  const card = useQuery({ queryKey: ['card'], queryFn: () => api<CardResponse>('/v1/me/card') });
  const [qr, setQr] = useState<QrTokenResponse | null>(null);
  const [qrError, setQrError] = useState<unknown>(null);
  const [remaining, setRemaining] = useState(0);
  const [locked, setLocked] = useState<boolean | null>(null);
  const focused = useRef(false);
  const skew = useRef(0);

  useEffect(() => {
    AsyncStorage.getItem(CARD_LOCK_KEY).then((v) => setLocked(v === '1'));
  }, []);

  const fetchQr = useCallback(async () => {
    if (!focused.current || AppState.currentState !== 'active') return;
    if (!onlineManager.isOnline()) {
      setQr(null);
      setQrError(new ApiError(0, 'NETWORK', ''));
      return;
    }
    try {
      const r = await api<QrTokenResponse>('/v1/me/card/qr-token', { method: 'POST' });
      skew.current = Date.parse(r.serverTime) - Date.now(); // expiry uses server time, not the phone clock
      setQr(r);
      setQrError(null);
    } catch (e) {
      setQr(null);
      setQrError(e);
      if (e instanceof ApiError && !e.isNetwork) void card.refetch();
    }
  }, [card]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void card.refetch();
      return () => {
        focused.current = false;
        setQr(null);
      };
    }, []), // eslint-disable-line react-hooks/exhaustive-deps
  );

  const canShow = card.data?.canShowQr && locked === false;
  useEffect(() => {
    if (canShow && !qr) void fetchQr();
  }, [canShow, qr, fetchQr]);

  useEffect(() => {
    if (!qr) return;
    const tick = () => {
      const left = Math.max(0, Math.round((Date.parse(qr.expiresAt) - (Date.now() + skew.current)) / 1000));
      setRemaining(left);
      if (left <= 3) void fetchQr(); // refresh just before expiry
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [qr, fetchQr]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') setQr(null);
    });
    return () => sub.remove();
  }, []);

  if (card.isLoading || locked === null) return <Screen><Loading /></Screen>;
  if (card.error && !card.data) return <Screen><ErrorState error={card.error} onRetry={() => card.refetch()} /></Screen>;
  const c = card.data!;
  const st = c.membership.state;

  return (
    <Screen onRefresh={() => card.refetch()} refreshing={card.isRefetching}>
      <DigitalCard name={c.holderName} serial={c.card?.serialNumber ?? null} state={st} endsAt={c.membership.subscriptionEndsAt} photoPath={c.hasApprovedPhoto ? '/v1/me/photo' : null} qrPayload={canShow ? qr?.payload : null} />
      {canShow && qr ? (
        <View style={{ alignItems: 'center', gap: 4 }} accessibilityLiveRegion="polite">
          <Text style={{ fontSize: 16, color: colors.text }}>{t('showToCashier')}</Text>
          <Text style={{ color: colors.muted }}>{t('qrRefreshIn')} {remaining}{t('seconds')}</Text>
        </View>
      ) : null}
      {c.canShowQr && locked ? (
        <Button title={t('unlockCard')} onPress={async () => {
          const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('unlockCard'), disableDeviceFallback: false });
          if (r.success) setLocked(false);
        }} />
      ) : null}
      {qrError ? <ErrorState error={qrError instanceof ApiError && qrError.isNetwork ? new ApiError(0, 'NETWORK', t('qrUnavailableOffline')) : qrError} onRetry={fetchQr} /> : null}

      {!c.hasApprovedPhoto && c.photoStatus !== 'PENDING' ? <Banner kind="warn">{t('photoNeeded')}</Banner> : null}
      {c.photoStatus === 'PENDING' ? <Banner>{t('photoPending')}</Banner> : null}
      {c.photoStatus === 'REJECTED' ? <Banner kind="error">{t('photoRejected')}</Banner> : null}
      {(c.photoStatus !== 'PENDING' && !c.hasApprovedPhoto) || c.photoStatus === 'REJECTED' ? <Button title={t('uploadPhoto')} onPress={() => router.push('/me/photo')} /> : null}
      {st === 'PENDING_ACTIVATION' ? <Banner>{t('awaitingActivation')}</Banner> : null}
      {st === 'EXPIRED' || st === 'SUSPENDED' || st === 'REVOKED' ? <Banner kind="error">{t(`state_${st}` as never)}</Banner> : null}
      {st !== 'ACTIVE' && cfg.data?.supportEmail ? <Button title={t('contactSupport')} variant="secondary" onPress={() => Linking.openURL(`mailto:${cfg.data!.supportEmail}`)} /> : null}
    </Screen>
  );
}
