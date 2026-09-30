'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client';
import { money, shiftDate, todayIn } from '@/lib/format';
import { useLang, useT } from '@/components/providers';
import { BarChart, ErrorBox, Loading } from '@/components/ui';

interface Dashboard {
  registeredUsers: number;
  newUsers: number;
  activeMembers: number;
  customersWhoRedeemed: number;
  confirmedRedemptions: number;
  voidedRedemptions: number;
  savingsMinor: number;
  activeStores: number;
  activeBranches: number;
  downloads: { value: number | null; source: string };
  period: { timezone: string };
}
interface Series {
  redemptions: Array<{ bucket: string; count: number; customers: number; discountMinor: number }>;
  newUsers: Array<{ bucket: string; count: number }>;
  topStores: Array<{ storeId: string; name: { ar: string; en: string }; count: number; customers: number; discountMinor: number }>;
}

export default function DashboardPage() {
  const t = useT();
  const lang = useLang();
  const today = todayIn();
  const [from, setFrom] = useState(shiftDate(today, -29));
  const [to, setTo] = useState(today);
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const d = useQuery({ queryKey: ['dash', from, to], queryFn: () => api<Dashboard>(`/v1/admin/dashboard?from=${from}&to=${to}`) });
  const s = useQuery({ queryKey: ['series', from, to, granularity], queryFn: () => api<Series>(`/v1/admin/reports/timeseries?from=${from}&to=${to}&granularity=${granularity}`) });

  const kpis: Array<[string, string]> = d.data
    ? [
        [t('registeredUsers'), String(d.data.registeredUsers)],
        [t('newUsers'), String(d.data.newUsers)],
        [t('activeMembers'), String(d.data.activeMembers)],
        [t('customersWhoRedeemed'), String(d.data.customersWhoRedeemed)],
        [t('confirmedRedemptions'), String(d.data.confirmedRedemptions)],
        [t('voidedRedemptions'), String(d.data.voidedRedemptions)],
        [t('savings'), money(d.data.savingsMinor, lang)],
        [t('activeStores'), String(d.data.activeStores)],
        [t('activeBranches'), String(d.data.activeBranches)],
        [t('downloads'), d.data.downloads.value == null ? t('notAvailable') : String(d.data.downloads.value)],
      ]
    : [];

  return (
    <>
      <h2>{t('dashboard')}</h2>
      <div className="row">
        <label>{t('from')}<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>{t('to')}<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <label>
          &nbsp;
          <select value={granularity} onChange={(e) => setGranularity(e.target.value as 'day')}>
            <option value="day">{t('day')}</option>
            <option value="week">{t('week')}</option>
            <option value="month">{t('month')}</option>
          </select>
        </label>
        {d.data && <span className="muted">{d.data.period.timezone}</span>}
      </div>
      {d.isLoading && <Loading />}
      {d.error && <ErrorBox error={d.error} onRetry={() => d.refetch()} />}
      <div className="grid">
        {kpis.map(([label, value]) => (
          <div key={label} className="card kpi">
            <div className="label">{label}</div>
            <div className="value">{value}</div>
          </div>
        ))}
      </div>
      {s.error && <ErrorBox error={s.error} onRetry={() => s.refetch()} />}
      {s.data && (
        <>
          <h3>{t('usageOverTime')}</h3>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <BarChart title={t('confirmedRedemptions')} data={s.data.redemptions.map((r) => ({ label: r.bucket, value: r.count }))} />
            <BarChart title={t('userGrowth')} data={s.data.newUsers.map((r) => ({ label: r.bucket, value: r.count }))} />
          </div>
          <h3>{t('topStores')}</h3>
          <table>
            <thead>
              <tr><th>#</th><th>{t('merchants')}</th><th className="num">{t('confirmedRedemptions')}</th><th className="num">{t('customersWhoRedeemed')}</th><th className="num">{t('savings')}</th></tr>
            </thead>
            <tbody>
              {s.data.topStores.map((st, i) => (
                <tr key={st.storeId}><td>{i + 1}</td><td>{st.name[lang]}</td><td className="num">{st.count}</td><td className="num">{st.customers}</td><td className="num">{money(st.discountMinor, lang)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
