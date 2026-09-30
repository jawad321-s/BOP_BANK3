import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { BranchPicker } from '../../src/components/BranchPicker';
import { Banner, Body, Button, Card, ErrorState, Field, Loading, Pill, Row, Screen, Subtitle } from '../../src/components/ui';
import { useBranch } from '../../src/state/branch';
import { useLang, useT } from '../../src/state/lang';

interface StaffResp {
  members: Array<{ membershipId: string; fullName: string; email: string; role: string; active: boolean; branches: Array<{ id: string; name: { ar: string; en: string } }> }>;
  pendingInvitations: Array<{ id: string; email: string; expiresAt: string }>;
}

/** Owner-only: invite cashiers to branches, change assignments, deactivate. Owners cannot grant OWNER/ADMIN. */
export default function Staff() {
  const t = useT();
  const lang = useLang();
  const { ws, branches } = useBranch();
  const merchantId = ws?.merchantId;
  const q = useQuery({ queryKey: ['staff', merchantId], enabled: !!merchantId && ws?.role === 'OWNER', queryFn: () => api<StaffResp>(`/v1/merchant/merchants/${merchantId}/staff`) });
  const [email, setEmail] = useState('');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (ws?.role !== 'OWNER') return <Screen><Banner kind="warn">403</Banner></Screen>;
  const branch = branches.find((b) => b.id === branchId);
  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.data?.members.map((m) => (
        <Card key={m.membershipId}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Subtitle>{m.fullName}</Subtitle>
            <Pill text={m.role} tone={m.active ? 'ok' : 'bad'} />
          </Row>
          <Body muted>{m.email}</Body>
          <Body>{m.branches.map((b) => b.name[lang]).join('، ')}</Body>
          {m.role === 'STAFF' ? (
            <Button title={m.active ? t('deactivate') : t('reactivate')} variant={m.active ? 'danger' : 'secondary'} onPress={() => api(`/v1/merchant/merchants/${merchantId}/staff/${m.membershipId}/active`, { method: 'PATCH', body: { active: !m.active } }).then(() => q.refetch()).catch(setError)} />
          ) : null}
        </Card>
      ))}
      <Card>
        <Subtitle>{t('invite')}</Subtitle>
        <Field label={t('email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={{ textAlign: 'left' }} />
        <BranchPicker branches={branches} value={branchId} onChange={setBranchId} />
        <Button title={t('invite')} disabled={!email.includes('@') || !branch} onPress={async () => {
          setError(null);
          setMsg(null);
          try {
            const r = await api<{ emailSent: boolean }>(`/v1/merchant/merchants/${merchantId}/staff/invitations`, { method: 'POST', body: { email: email.trim(), storeId: branch!.storeId, branchIds: [branch!.id] } });
            setMsg(r.emailSent ? t('invitationSent') : t('emailNotSent'));
            setEmail('');
            void q.refetch();
          } catch (e) {
            setError(e);
          }
        }} />
        {msg ? <Banner kind="ok">{msg}</Banner> : null}
      </Card>
      {error ? <ErrorState error={error} /> : null}
      {q.data?.pendingInvitations.map((i) => <Body key={i.id} muted>✉ {i.email}</Body>)}
    </Screen>
  );
}
