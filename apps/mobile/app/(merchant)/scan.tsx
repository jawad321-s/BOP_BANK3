import { useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useCallback } from 'react';
import type { VerificationView } from '@bitaqati/shared';
import { api } from '../../src/lib/api';
import { BranchPicker } from '../../src/components/BranchPicker';
import { Banner, Body, Button, ErrorState, Field, Screen, Subtitle } from '../../src/components/ui';
import { useBranch } from '../../src/state/branch';
import { useT } from '../../src/state/lang';

/** Choose branch → scan QR (or enter serial manually) → server creates a verification session. */
export default function Scan() {
  const t = useT();
  const { branches, branchId, setBranchId } = useBranch();
  const [perm, requestPerm] = useCameraPermissions();
  const [active, setActive] = useState(false);
  const [manual, setManual] = useState(false);
  const [serial, setSerial] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const lock = useRef(false);

  useFocusEffect(useCallback(() => {
    lock.current = false;
    setActive(true);
    return () => setActive(false);
  }, []));

  const start = async (body: { qrPayload?: string; serialNumber?: string }) => {
    if (!branchId || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const v = await api<VerificationView>('/v1/merchant/verifications', { method: 'POST', body: { branchId, ...body } });
      setSerial('');
      router.push(`/merchant/verification/${v.id}`);
    } catch (e) {
      setError(e);
      setTimeout(() => (lock.current = false), 1500);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <BranchPicker branches={branches} value={branchId} onChange={(id) => id && setBranchId(id)} />
      {!manual ? (
        perm?.granted ? (
          <View style={{ height: 320, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' }}>
            {active ? (
              <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={busy ? undefined : ({ data }) => start({ qrPayload: data })} accessibilityLabel={t('scan')} />
            ) : null}
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {perm && !perm.canAskAgain ? <Banner kind="warn">{t('cameraDenied')}</Banner> : null}
            {perm?.canAskAgain !== false ? <Button title={t('allowCamera')} onPress={() => requestPerm()} /> : <Button title={t('openSettings')} variant="secondary" onPress={() => Linking.openSettings()} />}
          </View>
        )
      ) : (
        <View style={{ gap: 8 }}>
          <Subtitle>{t('manualEntry')}</Subtitle>
          <Body muted>{t('manualHelp')}</Body>
          <Field label={t('serial')} value={serial} onChangeText={setSerial} autoCapitalize="characters" autoCorrect={false} placeholder="BT-XXXX-XXXX-XXXX" style={{ textAlign: 'left' }} />
          <Button title={t('submit')} loading={busy} disabled={serial.replace(/[^0-9A-Za-z]/g, '').length < 12} onPress={() => start({ serialNumber: serial })} />
        </View>
      )}
      {error ? <ErrorState error={error} /> : null}
      <Button title={manual ? t('scan') : t('manualEntry')} variant="ghost" onPress={() => { setManual(!manual); setError(null); }} />
    </Screen>
  );
}
