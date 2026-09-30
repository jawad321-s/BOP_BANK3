import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { dateTime } from '../../src/lib/format';
import { Body, Button, Card, ErrorState, Loading, Pill, Row, Screen, Title } from '../../src/components/ui';
import { useLang, useT } from '../../src/state/lang';

interface S { id: string; deviceName: string | null; platform: string | null; lastUsedAt: string; current: boolean }

export default function Devices() {
  const t = useT();
  const lang = useLang();
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => api<S[]>('/v1/me/sessions') });
  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <Title>{t('devices')}</Title>
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data?.map((s) => (
        <Card key={s.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Body>{s.deviceName ?? s.platform ?? '—'}</Body>
            {s.current ? <Pill text={t('thisDevice')} tone="ok" /> : null}
          </Row>
          <Body muted>{dateTime(s.lastUsedAt, lang)}</Body>
          {!s.current ? <Button title={t('signOut')} variant="secondary" onPress={() => api(`/v1/me/sessions/${s.id}`, { method: 'DELETE' }).then(() => q.refetch())} /> : null}
        </Card>
      ))}
      <Button title={t('signOutOthers')} variant="danger" onPress={() => api('/v1/me/sessions/revoke-others', { method: 'POST' }).then(() => q.refetch())} />
    </Screen>
  );
}
