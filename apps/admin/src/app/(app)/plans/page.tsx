'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseMajorToMinor } from '@bitaqati/shared';
import { api } from '@/lib/client';
import { money } from '@/lib/format';
import { useLang, useT } from '@/components/providers';
import { ErrorBox, Loading, StatusBadge } from '@/components/ui';

interface Plan { id: string; code: string; nameAr: string; nameEn: string; durationDays: number; priceMinor: number; active: boolean }

export default function PlansPage() {
  const t = useT();
  const lang = useLang();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['plans'], queryFn: () => api<Plan[]>('/v1/admin/plans') });
  const [f, setF] = useState({ code: '', nameAr: '', nameEn: '', durationDays: '365', price: '0' });
  const create = useMutation({
    mutationFn: () => api('/v1/admin/plans', { method: 'POST', body: { code: f.code.toUpperCase(), nameAr: f.nameAr, nameEn: f.nameEn, durationDays: Number(f.durationDays), priceMinor: parseMajorToMinor(f.price) ?? 0, active: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }),
  });
  const toggle = useMutation({ mutationFn: (p: Plan) => api(`/v1/admin/plans/${p.id}`, { method: 'PATCH', body: { active: !p.active } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }) });
  return (
    <>
      <h2>{t('plans')}</h2>
      <p className="notice">
        {lang === 'ar'
          ? 'السعر هنا معلوماتي للإدارة فقط. بيع العضوية داخل التطبيق غير مفعّل حتى يُحسم قرار الدفع (انظر docs/launch-decisions.md).'
          : 'Price is informational for admins only. In-app sale of memberships is not enabled until the payment decision is made (see docs/launch-decisions.md).'}
      </p>
      <form className="row card" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <label>Code<input required pattern="[A-Za-z0-9_]{2,40}" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
        <label>الاسم<input required value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></label>
        <label>Name<input required value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></label>
        <label>Days<input type="number" min={1} max={1100} required value={f.durationDays} onChange={(e) => setF({ ...f, durationDays: e.target.value })} /></label>
        <label>Price ₪<input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
        <button disabled={create.isPending}>{t('create')}</button>
      </form>
      {create.error && <ErrorBox error={create.error} />}
      <br />
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      <table>
        <tbody>{list.data?.map((p) => (
          <tr key={p.id}><td className="mono">{p.code}</td><td>{lang === 'ar' ? p.nameAr : p.nameEn}</td><td className="num">{p.durationDays}d</td><td className="num">{money(p.priceMinor, lang)}</td><td><StatusBadge value={p.active ? 'ACTIVE' : 'SUSPENDED'} /></td>
            <td><button className="secondary" onClick={() => toggle.mutate(p)}>{p.active ? 'Disable' : 'Enable'}</button></td></tr>
        ))}</tbody>
      </table>
    </>
  );
}
