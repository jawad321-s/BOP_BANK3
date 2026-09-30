'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/client';
import { dateTime } from '@/lib/format';
import { useLang, useT } from '@/components/providers';
import { ErrorBox, Loading, StatusBadge } from '@/components/ui';

type Audience = { kind: 'ALL_USERS' } | { kind: 'ACTIVE_MEMBERS' } | { kind: 'EXPIRING_WITHIN_DAYS'; days: number } | { kind: 'CITY'; city: string };
interface Broadcast { id: string; titleAr: string; titleEn: string; status: string; scheduledAt: string | null; sentAt: string | null; recipientCount: number | null; marketing: boolean; audience: Audience }

export default function NotificationsPage() {
  const t = useT();
  const lang = useLang();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['broadcasts'], queryFn: () => api<Broadcast[]>('/v1/admin/broadcasts') });
  const [f, setF] = useState({ titleAr: '', titleEn: '', bodyAr: '', bodyEn: '', kind: 'ACTIVE_MEMBERS', days: '7', city: '', marketing: true, scheduledAt: '' });
  const audience = (): Audience => (f.kind === 'EXPIRING_WITHIN_DAYS' ? { kind: 'EXPIRING_WITHIN_DAYS', days: Number(f.days) } : f.kind === 'CITY' ? { kind: 'CITY', city: f.city } : { kind: f.kind as 'ALL_USERS' });
  const preview = useMutation({ mutationFn: () => api<{ recipients: number }>('/v1/admin/broadcasts/preview', { method: 'POST', body: { audience: audience(), marketing: f.marketing } }) });
  const create = useMutation({
    mutationFn: () => api('/v1/admin/broadcasts', { method: 'POST', body: { titleAr: f.titleAr, titleEn: f.titleEn, bodyAr: f.bodyAr, bodyEn: f.bodyEn, audience: audience(), marketing: f.marketing, ...(f.scheduledAt ? { scheduledAt: new Date(f.scheduledAt).toISOString() } : {}) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['broadcasts'] }),
  });
  const act = useMutation({ mutationFn: ({ id, a }: { id: string; a: 'schedule' | 'cancel' }) => api(`/v1/admin/broadcasts/${id}/${a}`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['broadcasts'] }) });
  return (
    <>
      <h2>{t('notifications')}</h2>
      <p className="notice">
        {lang === 'ar'
          ? 'الإشعارات التسويقية تصل فقط لمن وافق عليها. لا تضع معلومات حساسة في نص الإشعار لأنه قد يظهر على شاشة القفل.'
          : 'Marketing messages reach opted-in users only. Never include sensitive data: pushes can appear on the lock screen.'}
      </p>
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div className="row">
          <label>العنوان<input required maxLength={80} value={f.titleAr} onChange={(e) => setF({ ...f, titleAr: e.target.value })} /></label>
          <label>Title<input required maxLength={80} value={f.titleEn} onChange={(e) => setF({ ...f, titleEn: e.target.value })} /></label>
        </div>
        <div className="row">
          <label>النص<textarea required maxLength={300} value={f.bodyAr} onChange={(e) => setF({ ...f, bodyAr: e.target.value })} /></label>
          <label>Body<textarea required maxLength={300} value={f.bodyEn} onChange={(e) => setF({ ...f, bodyEn: e.target.value })} /></label>
        </div>
        <div className="row">
          <label>Audience
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="ACTIVE_MEMBERS">Active members</option><option value="ALL_USERS">All users</option><option value="EXPIRING_WITHIN_DAYS">Expiring within N days</option><option value="CITY">City</option>
            </select>
          </label>
          {f.kind === 'EXPIRING_WITHIN_DAYS' && <label>Days<input type="number" min={1} max={60} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></label>}
          {f.kind === 'CITY' && <label>City<input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>}
          <label style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" checked={f.marketing} onChange={(e) => setF({ ...f, marketing: e.target.checked })} /> Marketing (opt-in only)</label>
          <label>Schedule (optional)<input type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} /></label>
        </div>
        <div className="row">
          <button type="button" className="secondary" onClick={() => preview.mutate()}>Preview recipients</button>
          {preview.data && <span><strong>{preview.data.recipients}</strong> recipients</span>}
          <button disabled={create.isPending}>Save draft</button>
        </div>
        {(preview.error || create.error) && <ErrorBox error={preview.error ?? create.error} />}
      </form>
      <br />
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      <table>
        <thead><tr><th>Title</th><th>Audience</th><th>{t('status')}</th><th>Scheduled</th><th>Sent</th><th className="num">Recipients</th><th /></tr></thead>
        <tbody>
          {list.data?.map((b) => (
            <tr key={b.id}>
              <td>{lang === 'ar' ? b.titleAr : b.titleEn}</td><td className="mono">{JSON.stringify(b.audience)}{b.marketing ? ' · marketing' : ''}</td><td><StatusBadge value={b.status} /></td>
              <td>{dateTime(b.scheduledAt, lang)}</td><td>{dateTime(b.sentAt, lang)}</td><td className="num">{b.recipientCount ?? '—'}</td>
              <td>
                {b.status === 'DRAFT' && <button onClick={() => { if (confirm(lang === 'ar' ? 'تأكيد الجدولة/الإرسال؟' : 'Schedule / send now?')) act.mutate({ id: b.id, a: 'schedule' }); }}>Send / schedule</button>}{' '}
                {(b.status === 'DRAFT' || b.status === 'SCHEDULED') && <button className="secondary" onClick={() => act.mutate({ id: b.id, a: 'cancel' })}>{t('cancel')}</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
