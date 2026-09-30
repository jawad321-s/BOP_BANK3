'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/client';
import { useT } from '@/components/providers';
import { Empty, ErrorBox, Loading, StatusBadge } from '@/components/ui';

interface Row { id: string; nameAr: string; nameEn: string; status: string; stores: number; members: number }

export default function MerchantsPage() {
  const t = useT();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['merchants'], queryFn: () => api<Row[]>('/v1/admin/merchants') });
  const [form, setForm] = useState({ nameAr: '', nameEn: '', legalName: '' });
  const create = useMutation({
    mutationFn: () => api('/v1/admin/merchants', { method: 'POST', body: { nameAr: form.nameAr, nameEn: form.nameEn, ...(form.legalName ? { legalName: form.legalName } : {}) } }),
    onSuccess: () => { setForm({ nameAr: '', nameEn: '', legalName: '' }); qc.invalidateQueries({ queryKey: ['merchants'] }); },
  });
  return (
    <>
      <h2>{t('merchants')}</h2>
      <form className="row card" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <label>الاسم بالعربية<input required value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} /></label>
        <label>Name (English)<input required value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} dir="ltr" /></label>
        <label>Legal name<input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} /></label>
        <button disabled={create.isPending}>{t('create')}</button>
      </form>
      {create.error && <ErrorBox error={create.error} />}
      <br />
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
      {list.data?.length === 0 && <Empty />}
      {list.data && list.data.length > 0 && (
        <table>
          <thead><tr><th>Name</th><th className="num">Stores</th><th className="num">Members</th><th>{t('status')}</th></tr></thead>
          <tbody>{list.data.map((m) => <tr key={m.id}><td><Link href={`/merchants/${m.id}`}>{m.nameAr} · {m.nameEn}</Link></td><td className="num">{m.stores}</td><td className="num">{m.members}</td><td><StatusBadge value={m.status} /></td></tr>)}</tbody>
        </table>
      )}
    </>
  );
}
