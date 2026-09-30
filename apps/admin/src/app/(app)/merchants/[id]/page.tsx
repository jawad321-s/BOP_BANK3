'use client';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseMajorToMinor } from '@bitaqati/shared';
import { api } from '@/lib/client';
import { dateTime, money, rate } from '@/lib/format';
import { useLang, useT } from '@/components/providers';
import { ErrorBox, Loading, ReasonAction, StatusBadge } from '@/components/ui';

interface Offer { id: string; version: number; rateBps: number; minEligibleMinor: number | null; maxDiscountMinor: number | null; termsAr: string; termsEn: string; status: string; createdAt: string }
interface Branch { id: string; nameAr: string; nameEn: string; city: string; addressAr: string; status: string; openingHours: Array<{ day: number; open: string; close: string }> }
interface Store { id: string; nameAr: string; nameEn: string; status: string; categoryId: string | null; logoUrl: string | null; branches: Branch[]; offers: Offer[]; images: Array<{ id: string; url: string }> }
interface Merchant {
  id: string; nameAr: string; nameEn: string; legalName: string | null; status: string;
  stores: Store[];
  memberships: Array<{ id: string; email: string; fullName: string; role: string; active: boolean; branchIds: string[] }>;
  invitations: Array<{ id: string; email: string; kind: string; expiresAt: string }>;
}
interface Category { id: string; nameAr: string; nameEn: string }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function OfferForm({ storeId, onDone }: { storeId: string; onDone: () => void }) {
  const [pct, setPct] = useState('');
  const [maxDiscount, setMaxDiscount] = useState('');
  const [minEligible, setMinEligible] = useState('');
  const [termsAr, setTermsAr] = useState('');
  const [termsEn, setTermsEn] = useState('');
  const bps = Math.round(Number(pct) * 100);
  const valid = Number.isFinite(bps) && bps > 0 && bps <= 10000;
  return (
    <div className="row">
      <label>Rate %<input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} size={6} /></label>
      <label>Max discount ₪ (optional)<input inputMode="decimal" value={maxDiscount} onChange={(e) => setMaxDiscount(e.target.value)} size={8} /></label>
      <label>Min eligible ₪ (optional)<input inputMode="decimal" value={minEligible} onChange={(e) => setMinEligible(e.target.value)} size={8} /></label>
      <label>الشروط<input value={termsAr} onChange={(e) => setTermsAr(e.target.value)} /></label>
      <label>Terms<input value={termsEn} onChange={(e) => setTermsEn(e.target.value)} /></label>
      {valid && (
        <ReasonAction
          label="Publish new offer version"
          onConfirm={(reason) =>
            api(`/v1/admin/stores/${storeId}/offers`, {
              method: 'POST',
              body: { rateBps: bps, termsAr, termsEn, reason, maxDiscountMinor: maxDiscount ? parseMajorToMinor(maxDiscount) : null, minEligibleMinor: minEligible ? parseMajorToMinor(minEligible) : null },
            }).then(onDone)
          }
        />
      )}
    </div>
  );
}

function BranchForm({ storeId, onDone }: { storeId: string; onDone: () => void }) {
  const [f, setF] = useState({ nameAr: '', nameEn: '', city: '', addressAr: '', addressEn: '', lat: '', lng: '', open: '09:00', close: '22:00' });
  const m = useMutation({
    mutationFn: () =>
      api(`/v1/admin/stores/${storeId}/branches`, {
        method: 'POST',
        body: {
          nameAr: f.nameAr, nameEn: f.nameEn, city: f.city, addressAr: f.addressAr, addressEn: f.addressEn,
          ...(f.lat && f.lng ? { lat: Number(f.lat), lng: Number(f.lng) } : {}),
          openingHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: f.open, close: f.close })),
        },
      }),
    onSuccess: onDone,
  });
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <label>اسم الفرع<input required value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></label>
      <label>Branch name<input required value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></label>
      <label>City<input required value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
      <label>العنوان<input value={f.addressAr} onChange={(e) => setF({ ...f, addressAr: e.target.value })} /></label>
      <label>Lat<input value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} size={8} /></label>
      <label>Lng<input value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} size={8} /></label>
      <label>Opens<input type="time" value={f.open} onChange={(e) => setF({ ...f, open: e.target.value })} /></label>
      <label>Closes<input type="time" value={f.close} onChange={(e) => setF({ ...f, close: e.target.value })} /></label>
      <button disabled={m.isPending}>Add branch</button>
      {m.error && <ErrorBox error={m.error} />}
    </form>
  );
}

export default function MerchantDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const lang = useLang();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['merchant', id], queryFn: () => api<Merchant>(`/v1/admin/merchants/${id}`) });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/v1/admin/categories') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['merchant', id] });
  const [store, setStore] = useState({ nameAr: '', nameEn: '', categoryId: '', descriptionAr: '', descriptionEn: '' });
  const [invite, setInvite] = useState({ email: '', kind: 'MERCHANT_OWNER', branchIds: [] as string[] });
  const createStore = useMutation({ mutationFn: () => api('/v1/admin/stores', { method: 'POST', body: { ...store, merchantId: id } }), onSuccess: () => { setStore({ nameAr: '', nameEn: '', categoryId: '', descriptionAr: '', descriptionEn: '' }); refresh(); } });
  const sendInvite = useMutation({
    mutationFn: () => api<{ emailSent: boolean }>('/v1/admin/invitations', { method: 'POST', body: { email: invite.email, kind: invite.kind, merchantId: id, ...(invite.kind === 'MERCHANT_STAFF' ? { branchIds: invite.branchIds } : {}) } }),
    onSuccess: refresh,
  });
  const upload = async (storeId: string, kind: 'logo' | 'images', file: File) => {
    const form = new FormData();
    form.append('image', file);
    await api(`/v1/admin/stores/${storeId}/${kind}`, { method: 'POST', form });
    refresh();
  };

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const m = q.data!;
  const allBranches = m.stores.flatMap((s) => s.branches.map((b) => ({ ...b, storeName: s.nameEn })));

  return (
    <>
      <h2>{m.nameAr} · {m.nameEn} <StatusBadge value={m.status} /></h2>
      <div className="row">
        {m.status !== 'ACTIVE' && <ReasonAction label="Activate merchant" onConfirm={(reason) => api(`/v1/admin/merchants/${id}/status`, { method: 'POST', body: { status: 'ACTIVE', reason } }).then(refresh)} />}
        {m.status === 'ACTIVE' && <ReasonAction label="Suspend merchant" danger onConfirm={(reason) => api(`/v1/admin/merchants/${id}/status`, { method: 'POST', body: { status: 'SUSPENDED', reason } }).then(refresh)} />}
      </div>

      {m.stores.map((s) => {
        const active = s.offers.find((o) => o.status === 'ACTIVE');
        return (
          <section key={s.id} className="card" style={{ marginBottom: 16 }}>
            <h3>{s.nameAr} · {s.nameEn} <StatusBadge value={s.status} /></h3>
            <div className="row">
              {s.status !== 'ACTIVE' && <ReasonAction label="Activate store" onConfirm={(reason) => api(`/v1/admin/stores/${s.id}/status`, { method: 'POST', body: { status: 'ACTIVE', reason } }).then(refresh)} />}
              {s.status === 'ACTIVE' && <ReasonAction label="Suspend store" danger onConfirm={(reason) => api(`/v1/admin/stores/${s.id}/status`, { method: 'POST', body: { status: 'SUSPENDED', reason } }).then(refresh)} />}
              <label>Logo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && upload(s.id, 'logo', e.target.files[0])} /></label>
              <label>Gallery image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && upload(s.id, 'images', e.target.files[0])} /></label>
            </div>
            {s.logoUrl && <img src={s.logoUrl} alt="" width={64} height={64} style={{ borderRadius: 8 }} />}
            <h4>Offer</h4>
            {active ? (
              <p>v{active.version}: <strong>{rate(active.rateBps)}</strong>{active.maxDiscountMinor ? ` · max ${money(active.maxDiscountMinor, lang)}` : ''}{active.minEligibleMinor ? ` · min ${money(active.minEligibleMinor, lang)}` : ''} — {lang === 'ar' ? active.termsAr : active.termsEn}</p>
            ) : <p className="muted">No active offer (store cannot be activated without one)</p>}
            <OfferForm storeId={s.id} onDone={refresh} />
            {active && <ReasonAction label="Deactivate offer" danger onConfirm={(reason) => api(`/v1/admin/stores/${s.id}/offers/deactivate`, { method: 'POST', body: { reason } }).then(refresh)} />}
            <details><summary>Offer history</summary>
              <table><tbody>{s.offers.map((o) => <tr key={o.id}><td>v{o.version}</td><td>{rate(o.rateBps)}</td><td><StatusBadge value={o.status} /></td><td>{dateTime(o.createdAt, lang)}</td></tr>)}</tbody></table>
            </details>
            <h4>Branches</h4>
            <table>
              <tbody>
                {s.branches.map((b) => (
                  <tr key={b.id}>
                    <td>{b.nameAr} · {b.nameEn}</td><td>{b.city}</td>
                    <td className="muted">{b.openingHours.map((h) => `${DAYS[h.day]} ${h.open}-${h.close}`).join(', ')}</td>
                    <td><StatusBadge value={b.status} /></td>
                    <td>{b.status === 'ACTIVE'
                      ? <ReasonAction label="Suspend" danger onConfirm={(reason) => api(`/v1/admin/branches/${b.id}/status`, { method: 'POST', body: { status: 'SUSPENDED', reason } }).then(refresh)} />
                      : <ReasonAction label="Activate" onConfirm={(reason) => api(`/v1/admin/branches/${b.id}/status`, { method: 'POST', body: { status: 'ACTIVE', reason } }).then(refresh)} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <BranchForm storeId={s.id} onDone={refresh} />
          </section>
        );
      })}

      <h3>New store</h3>
      <form className="row card" onSubmit={(e) => { e.preventDefault(); createStore.mutate(); }}>
        <label>اسم المحل<input required value={store.nameAr} onChange={(e) => setStore({ ...store, nameAr: e.target.value })} /></label>
        <label>Store name<input required value={store.nameEn} onChange={(e) => setStore({ ...store, nameEn: e.target.value })} /></label>
        <label>Category
          <select required value={store.categoryId} onChange={(e) => setStore({ ...store, categoryId: e.target.value })}>
            <option value="">—</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{lang === 'ar' ? c.nameAr : c.nameEn}</option>)}
          </select>
        </label>
        <label>الوصف<input value={store.descriptionAr} onChange={(e) => setStore({ ...store, descriptionAr: e.target.value })} /></label>
        <label>Description<input value={store.descriptionEn} onChange={(e) => setStore({ ...store, descriptionEn: e.target.value })} /></label>
        <button disabled={createStore.isPending}>{t('create')}</button>
      </form>
      {createStore.error && <ErrorBox error={createStore.error} />}

      <h3>People</h3>
      <table>
        <tbody>
          {m.memberships.map((x) => (
            <tr key={x.id}>
              <td>{x.fullName}</td><td className="mono">{x.email}</td><td>{x.role}</td><td>{x.active ? <StatusBadge value="ACTIVE" /> : <StatusBadge value="SUSPENDED" />}</td>
              <td><ReasonAction label={x.active ? 'Deactivate' : 'Reactivate'} danger={x.active} onConfirm={(reason) => api(`/v1/admin/memberships/${x.id}/active`, { method: 'POST', body: { active: !x.active, reason } }).then(refresh)} /></td>
            </tr>
          ))}
          {m.invitations.map((i) => (
            <tr key={i.id}><td className="muted">invited</td><td className="mono">{i.email}</td><td>{i.kind}</td><td>{dateTime(i.expiresAt, lang)}</td>
              <td><button className="secondary" onClick={() => api(`/v1/admin/invitations/${i.id}`, { method: 'DELETE' }).then(refresh)}>Revoke</button></td></tr>
          ))}
        </tbody>
      </table>
      <form className="row card" onSubmit={(e) => { e.preventDefault(); sendInvite.mutate(); }}>
        <label>{t('email')}<input type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} dir="ltr" /></label>
        <label>Role
          <select value={invite.kind} onChange={(e) => setInvite({ ...invite, kind: e.target.value })}>
            <option value="MERCHANT_OWNER">Owner</option><option value="MERCHANT_STAFF">Staff (cashier)</option>
          </select>
        </label>
        {invite.kind === 'MERCHANT_STAFF' && (
          <label>Branches
            <select multiple value={invite.branchIds} onChange={(e) => setInvite({ ...invite, branchIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}>
              {allBranches.map((b) => <option key={b.id} value={b.id}>{b.storeName} — {b.nameEn}</option>)}
            </select>
          </label>
        )}
        <button disabled={sendInvite.isPending}>Invite</button>
      </form>
      {sendInvite.data && !sendInvite.data.emailSent && <p className="error">Invitation created, but the email was NOT sent (mail transport not configured). Configure SMTP and re-send.</p>}
      {sendInvite.error && <ErrorBox error={sendInvite.error} />}
    </>
  );
}
