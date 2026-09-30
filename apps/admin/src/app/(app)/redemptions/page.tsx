'use client';
import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/client';
import { dateTime, money, rate } from '@/lib/format';
import { useLang, useT } from '@/components/providers';
import { Empty, ErrorBox, Loading, ReasonAction, StatusBadge } from '@/components/ui';

interface Row {
  id: string; ref: string; status: string; store: { name: { ar: string; en: string } }; branch: { name: { ar: string; en: string } };
  businessDate: string; confirmedAt: string; grossMinor: number; eligibleMinor: number; rateBps: number; discountMinor: number; netMinor: number;
  customerName: string; customerEmail: string; staffName: string; voidReason: string | null; voidedAt: string | null;
}

export default function RedemptionsPage() {
  const t = useT();
  const lang = useLang();
  const qc = useQueryClient();
  const [f, setF] = useState({ ref: '', userEmail: '', from: '', to: '', status: '' });
  const [applied, setApplied] = useState(f);
  const params = (cursor?: string) => {
    const p = new URLSearchParams({ limit: '25' });
    Object.entries(applied).forEach(([k, v]) => v && p.set(k, v));
    if (cursor) p.set('cursor', cursor);
    return p;
  };
  const list = useInfiniteQuery({
    queryKey: ['redemptions', applied],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<{ items: Row[]; nextCursor: string | null }>(`/v1/admin/redemptions?${params(pageParam || undefined)}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const exportParams = new URLSearchParams();
  Object.entries(applied).forEach(([k, v]) => v && exportParams.set(k, v));
  return (
    <>
      <h2>{t('redemptions')}</h2>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setApplied(f); }}>
        <label>Ref<input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} placeholder="R-…" /></label>
        <label>{t('email')}<input value={f.userEmail} onChange={(e) => setF({ ...f, userEmail: e.target.value })} /></label>
        <label>{t('from')}<input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label>{t('to')}<input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <label>{t('status')}<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">—</option><option>CONFIRMED</option><option>VOIDED</option></select></label>
        <button>{t('search')}</button>
        <a className="btn secondary" href={`/api/proxy/v1/admin/redemptions/export.csv?${exportParams}`}>{t('exportCsv')}</a>
      </form>
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
      {!list.isLoading && rows.length === 0 && <Empty />}
      {rows.length > 0 && (
        <table>
          <thead><tr><th>Ref</th><th>Date</th><th>Store / branch</th><th>Customer</th><th className="num">Invoice</th><th className="num">Rate</th><th className="num">Discount</th><th className="num">Net</th><th>{t('status')}</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.ref}</td>
                <td>{dateTime(r.confirmedAt, lang)}<div className="muted mono">{r.businessDate}</div></td>
                <td>{r.store.name[lang]}<div className="muted">{r.branch.name[lang]} · {r.staffName}</div></td>
                <td>{r.customerName}<div className="muted mono">{r.customerEmail}</div></td>
                <td className="num">{money(r.grossMinor, lang)}{r.eligibleMinor !== r.grossMinor && <div className="muted">elig. {money(r.eligibleMinor, lang)}</div>}</td>
                <td className="num">{rate(r.rateBps)}</td>
                <td className="num">{money(r.discountMinor, lang)}</td>
                <td className="num">{money(r.netMinor, lang)}</td>
                <td><StatusBadge value={r.status} />{r.voidReason && <div className="muted">{r.voidReason}</div>}</td>
                <td>{r.status === 'CONFIRMED' && <ReasonAction label={t('void')} danger onConfirm={(reason) => api(`/v1/admin/redemptions/${r.id}/void`, { method: 'POST', body: { reason } }).then(() => qc.invalidateQueries({ queryKey: ['redemptions'] }))} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.hasNextPage && <p><button className="secondary" onClick={() => list.fetchNextPage()}>{t('loadMore')}</button></p>}
    </>
  );
}
