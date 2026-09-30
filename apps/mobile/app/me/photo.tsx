import { useState } from 'react';
import { Image, Linking } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { Banner, Body, Button, ErrorState, Screen, Title } from '../../src/components/ui';
import { useT } from '../../src/state/lang';

/** Uploading a new photo sends it for admin review; merchants keep seeing the previously approved photo until then. */
export default function PhotoScreen() {
  const t = useT();
  const qc = useQueryClient();
  const [uri, setUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const pick = async (camera: boolean) => {
    setError(null);
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setDenied(true);
    setDenied(false);
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8, exif: false, cameraType: ImagePicker.CameraType.front };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!r.canceled) setUri(r.assets[0].uri);
  };

  const upload = async () => {
    if (!uri) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('photo', { uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
      await api('/v1/me/photo', { method: 'POST', form });
      await qc.invalidateQueries({ queryKey: ['card'] });
      setDone(true);
    } catch (e) {
      setError(e); // server message: unsupported / too large / network
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>{t('uploadPhoto')}</Title>
      <Body muted>{t('photoNeeded')}</Body>
      {uri ? <Image source={{ uri }} style={{ width: 220, height: 220, borderRadius: 16, alignSelf: 'center' }} accessibilityIgnoresInvertColors /> : null}
      {done ? (
        <>
          <Banner kind="ok">{t('photoPending')}</Banner>
          <Button title="✓" onPress={() => router.back()} />
        </>
      ) : (
        <>
          <Button title={t('takePhoto')} variant="secondary" onPress={() => pick(true)} />
          <Button title={t('choosePhoto')} variant="secondary" onPress={() => pick(false)} />
          {denied ? <Button title={t('openSettings')} variant="ghost" onPress={() => Linking.openSettings()} /> : null}
          {error ? <ErrorState error={error} onRetry={upload} /> : null}
          <Button title={t('submit')} disabled={!uri} loading={busy} onPress={upload} />
        </>
      )}
    </Screen>
  );
}
