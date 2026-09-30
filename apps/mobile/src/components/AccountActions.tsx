import { Alert, Linking } from 'react-native';
import { router } from 'expo-router';
import * as Updates from 'expo-updates';
import { api } from '../lib/api';
import { setLanguage } from '../lib/i18n';
import { useConfig } from '../lib/useConfig';
import { useAuth } from '../state/auth';
import { useLang, useT } from '../state/lang';
import { Button, Card, Subtitle } from './ui';

/** Workspace switch, language, support links and sign-out (shared by member and merchant spaces). */
export function AccountActions() {
  const t = useT();
  const lang = useLang();
  const { me, signOut, setWorkspace, workspace } = useAuth();
  const cfg = useConfig();
  return (
    <>
      {me && me.workspaces.merchant.length > 0 ? (
        <Card>
          {workspace.kind === 'user'
            ? me.workspaces.merchant.map((m) => (
                <Button key={m.membershipId} title={`${t('switchToMerchant')}: ${m.merchantName[lang]}`} variant="secondary" onPress={async () => { await setWorkspace({ kind: 'merchant', membershipId: m.membershipId }); router.replace('/'); }} />
              ))
            : <Button title={t('switchToUser')} variant="secondary" onPress={async () => { await setWorkspace({ kind: 'user' }); router.replace('/'); }} />}
        </Card>
      ) : null}
      <Card>
        <Subtitle>{t('language')}</Subtitle>
        <Button title={t('switchLanguage')} variant="secondary" onPress={async () => {
          const next = lang === 'ar' ? 'en' : 'ar';
          await api('/v1/me', { method: 'PATCH', body: { locale: next } }).catch(() => undefined);
          if (await setLanguage(next)) Alert.alert(t('restartForLanguage'));
          await Updates.reloadAsync().catch(() => undefined);
        }} />
      </Card>
      <Card>
        <Subtitle>{t('support')}</Subtitle>
        {cfg.data?.supportEmail ? <Button title={cfg.data.supportEmail} variant="ghost" onPress={() => Linking.openURL(`mailto:${cfg.data!.supportEmail}`)} /> : null}
        {cfg.data?.supportPhone ? <Button title={cfg.data.supportPhone} variant="ghost" onPress={() => Linking.openURL(`tel:${cfg.data!.supportPhone}`)} /> : null}
        {cfg.data?.privacyUrl ? <Button title={t('privacy')} variant="ghost" onPress={() => Linking.openURL(cfg.data!.privacyUrl!)} /> : null}
        {cfg.data?.termsUrl ? <Button title={t('terms')} variant="ghost" onPress={() => Linking.openURL(cfg.data!.termsUrl!)} /> : null}
      </Card>
      <Button title={t('signOut')} variant="secondary" onPress={async () => { await signOut(); router.replace('/welcome'); }} />
    </>
  );
}

