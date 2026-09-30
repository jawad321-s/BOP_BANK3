'use client';
import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/client';
import { dateTime } from '@/lib/format';
import { useLang, useT } from '@/components/providers';
import { ErrorBox, Loading } from '@/components/ui';

interface Row { id: string; action: string; entityType: string; entityId: string | null; actorUserId: string | null; reason: string | null; before: unknown; after: unknown; createdAt: string }

export default function AuditPage() {
  const t = useT();
  const lang = useLang();
  const [action, setAction] = useState('');
  const [applied, setApplied] = useState('');
  const list = useInfiniteQuery({
    queryKey: ['audit', applied],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<{ items: Row[]; nextCursor: string | null }>(`/v1/admin/audit-logs?limit=50${applied ? `&action=${encodeURIComponent(applied)}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <h2>{t('audit')}</h2>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setApplied(action); }}>
        <label>Action prefix<input value={action} onChange={(e) => setAction(e.target.value)} placeholder="redemption., card., offer." /></label>
        <button>{t('search')}</button>
      </form>
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      <table>
        <thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Actor</th><th>Reason</th><th>Change</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{dateTime(r.createdAt, lang)}</td><td className="mono">{r.action}</td><td className="mono">{r.entityType}:{r.entityId?.slice(0, 8)}</td>
              <td className="mono">{r.actorUserId?.slice(0, 8)}</td><td>{r.reason}</td>
              <td><details><summary>diff</summary><pre className="mono" style={{ whiteSpace: 'pre-wrap', maxWidth: 360 }}>{JSON.stringify({ before: r.before, after: r.after }, null, 1)}</pre></details></td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.hasNextPage && <p><button className="secondary" onClick={() => list.fetchNextPage()}>{t('loadMore')}</button></p>}
    </>
  );
}
