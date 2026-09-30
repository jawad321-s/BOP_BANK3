'use client';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/client';
import { dateTime, money, rate } from '@/lib/format';
import { useLang, useT } from '@/components/providers';
import { ErrorBox, Loading, ReasonAction, StatusBadge } from '@/components/ui';

interface Detail {
  id: string; email: string; emailVerified: boolean; status: string; statusReason: string | null; createdAt: string; fullName: string;
  photo: { status: string; hasApproved: boolean; hasPending: boolean; rejectReason: string | null };
  membershipState: string;
  cards: Array<{ id: string; serialNumber: string; status: string; isCurrent: boolean; issuedAt: string; statusReason: string | null }>;
  subscriptions: Array<{ id: string; plan: { code: string; name: { ar: string; en: string } }; startsAt: string; endsAt: string; status: string; reason: string; paymentReference: string | null; cancelReason: string | null }>;
  memberships: Array<{ merchantId: string; merchantName: string; role: string; active: boolean }>;
  adminPermissions: string[];
  activeSessions: number;
  recentRedemptions: Array<{ id: string; ref: string; status: string; store: { name: { ar: string; en: string } }; confirmedAt: string; discountMinor: number; rateBps: number }>;
  audit: Array<{ id: string; action: string; reason: string | null; createdAt: string; actorUserId: string | null }>;
}
interface Plan { id: string; code: string; nameAr: string; nameEn: string; durationDays: number; active: boolean }

export default function UserDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const lang = useLang();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['user', id], queryFn: () => api<Detail>(`/v1/admin/users/${id}`) });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api<Plan[]>('/v1/admin/plans') });
  const [planId, setPlanId] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['user', id] });
  const review = useMutation({
    mutationFn: (body: { decision: 'APPROVE' } | { decision: 'REJECT'; reason: string }) => api(`/v1/admin/users/${id}/photo/review`, { method: 'POST', body }),
    onSuccess: refresh,
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const u = q.data!;
  const current = u.cards.find((c) => c.isCurrent);
  const cardAction = (action: string) => (reason: string) => api(`/v1/admin/users/${id}/card`, { method: 'POST', body: { action, reason } }).then(refresh);

  return (
    <>
      <h2>{u.fullName} <StatusBadge value={u.status} /> <StatusBadge value={u.membershipState} /></h2>
      <p className="mono">{u.email} {u.emailVerified ? '✓' : '(unverified)'}</p>
      <p className="muted">{dateTime(u.createdAt, lang)} · sessions: {u.activeSessions}</p>
      <div className="row">
        {u.status === 'ACTIVE' ? (
          <ReasonAction label="Suspend account" danger onConfirm={(reason) => api(`/v1/admin/users/${id}/status`, { method: 'POST', body: { status: 'SUSPENDED', reason } }).then(refresh)} />
        ) : u.status === 'SUSPENDED' ? (
          <ReasonAction label="Reactivate account" onConfirm={(reason) => api(`/v1/admin/users/${id}/status`, { method: 'POST', body: { status: 'ACTIVE', reason } }).then(refresh)} />
        ) : null}
      </div>

      <h3>Photo</h3>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <figure>
          {u.photo.hasApproved ? <img className="photo" src={`/api/proxy/v1/admin/users/${id}/photo`} alt="approved" /> : <div className="photo" />}
          <figcaption>Approved (shown to merchants)</figcaption>
        </figure>
        {u.photo.hasPending && (
          <figure>
            <img className="photo" src={`/api/proxy/v1/admin/users/${id}/photo?which=pending`} alt="pending" />
            <figcaption>Pending review</figcaption>
            <div className="stack">
              <button onClick={() => review.mutate({ decision: 'APPROVE' })} disabled={review.isPending}>Approve</button>
              <label>Reject reason<input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} /></label>
              <button className="danger" disabled={rejectReason.trim().length < 3 || review.isPending} onClick={() => review.mutate({ decision: 'REJECT', reason: rejectReason })}>Reject</button>
            </div>
          </figure>
        )}
      </div>
      {u.photo.rejectReason && <p className="muted">Last rejection: {u.photo.rejectReason}</p>}
      {review.error && <ErrorBox error={review.error} />}

      <h3>Card</h3>
      {current ? (
        <p><span className="mono">{current.serialNumber}</span> <StatusBadge value={current.status} /> {current.statusReason && <span className="muted">— {current.statusReason}</span>}</p>
      ) : <p className="muted">No current card</p>}
      <div className="row">
        {current?.status === 'PENDING' && <ReasonAction label="Activate card" onConfirm={cardAction('ACTIVATE')} />}
        {current?.status === 'ACTIVE' && <ReasonAction label="Suspend card" danger onConfirm={cardAction('SUSPEND')} />}
        {(current?.status === 'SUSPENDED' || current?.status === 'EXPIRED') && <ReasonAction label="Reactivate card" onConfirm={cardAction('REACTIVATE')} />}
        {current && current.status !== 'REVOKED' && <ReasonAction label="Replace card (new serial)" onConfirm={cardAction('REPLACE')} />}
        {current && current.status !== 'REVOKED' && <ReasonAction label="Revoke card" danger onConfirm={cardAction('REVOKE')} />}
        {(!current || current.status === 'REVOKED') && <ReasonAction label="Issue new card" onConfirm={cardAction('ISSUE')} />}
      </div>
      <details><summary>Card history</summary>
        <table><tbody>{u.cards.map((c) => <tr key={c.id}><td className="mono">{c.serialNumber}</td><td><StatusBadge value={c.status} /></td><td>{dateTime(c.issuedAt, lang)}</td><td>{c.statusReason}</td></tr>)}</tbody></table>
      </details>

      <h3>{t('plans')}</h3>
      <p className="notice">Manual activation (v1). Only grant time after payment has been verified out-of-band; the app never grants time from a client payment claim.</p>
      <div className="row">
        <label>Plan
          <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">—</option>
            {plans.data?.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{lang === 'ar' ? p.nameAr : p.nameEn} ({p.durationDays}d)</option>)}
          </select>
        </label>
        <label>Payment reference<input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} /></label>
        {planId && <ReasonAction label="Grant / renew" onConfirm={(reason) => api(`/v1/admin/users/${id}/subscriptions`, { method: 'POST', body: { planId, reason, ...(paymentReference ? { paymentReference } : {}) } }).then(refresh)} />}
      </div>
      <table>
        <thead><tr><th>Plan</th><th>Start</th><th>End</th><th>{t('status')}</th><th>Reason</th><th /></tr></thead>
        <tbody>
          {u.subscriptions.map((s) => (
            <tr key={s.id}>
              <td>{s.plan.name[lang]}</td><td>{dateTime(s.startsAt, lang)}</td><td>{dateTime(s.endsAt, lang)}</td><td><StatusBadge value={s.status} /></td>
              <td>{s.reason}{s.paymentReference ? ` · ${s.paymentReference}` : ''}{s.cancelReason ? ` · ✗ ${s.cancelReason}` : ''}</td>
              <td>{s.status === 'ACTIVE' && <ReasonAction label="Cancel" danger onConfirm={(reason) => api(`/v1/admin/subscriptions/${s.id}/cancel`, { method: 'POST', body: { reason } }).then(refresh)} />}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{t('redemptions')}</h3>
      <table>
        <tbody>
          {u.recentRedemptions.map((r) => (
            <tr key={r.id}><td className="mono">{r.ref}</td><td>{r.store.name[lang]}</td><td>{dateTime(r.confirmedAt, lang)}</td><td className="num">{rate(r.rateBps)}</td><td className="num">{money(r.discountMinor, lang)}</td><td><StatusBadge value={r.status} /></td></tr>
          ))}
        </tbody>
      </table>

      {u.memberships.length > 0 && (<><h3>Merchant roles</h3><ul>{u.memberships.map((m) => <li key={m.merchantId}>{m.merchantName} — {m.role} {m.active ? '' : '(inactive)'}</li>)}</ul></>)}
      {u.adminPermissions.length > 0 && (<><h3>Admin permissions</h3><p className="mono">{u.adminPermissions.join(', ')}</p></>)}

      <h3>{t('audit')}</h3>
      <table><tbody>{u.audit.map((a) => <tr key={a.id}><td>{dateTime(a.createdAt, lang)}</td><td className="mono">{a.action}</td><td>{a.reason}</td></tr>)}</tbody></table>
    </>
  );
}
