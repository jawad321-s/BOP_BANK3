'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/client';
import { dateTime } from '@/lib/format';
import { useLang, useT } from '@/components/providers';
import { Empty, ErrorBox, Loading, StatusBadge } from '@/components/ui';

interface Row { id: string; email: string; fullName: string; status: string; photoStatus: string; card: { serialNumber: string; status: string } | null; subscriptionEndsAt: string | null; createdAt: string }

export default function UsersPage() {
  const t = useT();
  const lang = useLang();
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState({ q: '', photoStatus: '', membership: '' });
  const [photoStatus, setPhotoStatus] = useState('');
  const [membership, setMembership] = useState('');
  const list = useInfiniteQuery({
    queryKey: ['users', applied],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: '25' });
      if (applied.q) p.set('q', applied.q);
      if (applied.photoStatus) p.set('photoStatus', applied.photoStatus);
      if (applied.membership) p.set('membership', applied.membership);
      if (pageParam) p.set('cursor', pageParam);
      return api<{ items: Row[]; nextCursor: string | null }>(`/v1/admin/users?${p}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <h2>{t('users')}</h2>
      <form className="row" onSubmit={(e) => { e.preventDefault(); setApplied({ q, photoStatus, membership }); }}>
        <label>{t('search')}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="email / name / BT-…" /></label>
        <label>Photo
          <select value={photoStatus} onChange={(e) => setPhotoStatus(e.target.value)}>
            <option value="">—</option><option value="PENDING">PENDING</option><option value="APPROVED">APPROVED</option><option value="REJECTED">REJECTED</option><option value="NONE">NONE</option>
          </select>
        </label>
        <label>Membership
          <select value={membership} onChange={(e) => setMembership(e.target.value)}>
            <option value="">—</option><option value="ACTIVE">ACTIVE</option><option value="EXPIRED">EXPIRED</option><option value="NONE">NONE</option>
          </select>
        </label>
        <button>{t('search')}</button>
      </form>
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} onRetry={() => list.refetch()} />}
      {!list.isLoading && rows.length === 0 && <Empty />}
      {rows.length > 0 && (
        <table>
          <thead><tr><th>Name</th><th>{t('email')}</th><th>Card</th><th>Photo</th><th>Ends</th><th>{t('status')}</th></tr></thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td><Link href={`/users/${u.id}`}>{u.fullName}</Link></td>
                <td className="mono">{u.email}</td>
                <td>{u.card ? <><span className="mono">{u.card.serialNumber}</span> <StatusBadge value={u.card.status} /></> : '—'}</td>
                <td><StatusBadge value={u.photoStatus} /></td>
                <td>{dateTime(u.subscriptionEndsAt, lang)}</td>
                <td><StatusBadge value={u.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.hasNextPage && <p><button className="secondary" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>{t('loadMore')}</button></p>}
    </>
  );
}
