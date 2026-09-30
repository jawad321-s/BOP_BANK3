'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client';
import { useLang, useT } from '@/components/providers';
import { ErrorBox, Loading, ReasonAction } from '@/components/ui';

interface Settings { appNameAr: string; appNameEn: string; supportEmail: string | null; supportPhone: string | null; privacyUrl: string | null; termsUrl: string | null; timezone: string; qrTtlSeconds: number; maxInvoiceMinor: number }

export default function SettingsPage() {
  const t = useT();
  const lang = useLang();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/v1/admin/settings') });
  const [f, setF] = useState<Settings | null>(null);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);
  const save = useMutation({ mutationFn: (reason: string) => api('/v1/admin/settings', { method: 'PATCH', body: { ...clean(f!), reason } }), onSuccess: () => q.refetch() });
  if (q.isLoading || !f) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const set = (k: keyof Settings, v: string | number) => setF({ ...f, [k]: v });
  return (
    <>
      <h2>{t('settings')}</h2>
      <p className="notice">
        {lang === 'ar'
          ? 'تغيير المنطقة الزمنية يؤثر على تاريخ يوم الاستخدام للعمليات القادمة فقط. كل تغيير يُسجل مع سبب.'
          : 'Changing the time zone affects business dates of future transactions only. Every change is audited with a reason.'}
      </p>
      <div className="card stack">
        <div className="row">
          <label>اسم التطبيق<input value={f.appNameAr} onChange={(e) => set('appNameAr', e.target.value)} /></label>
          <label>App name<input value={f.appNameEn} onChange={(e) => set('appNameEn', e.target.value)} /></label>
        </div>
        <div className="row">
          <label>Support email<input type="email" value={f.supportEmail ?? ''} onChange={(e) => set('supportEmail', e.target.value)} dir="ltr" /></label>
          <label>Support phone<input value={f.supportPhone ?? ''} onChange={(e) => set('supportPhone', e.target.value)} dir="ltr" /></label>
          <label>Privacy URL<input type="url" value={f.privacyUrl ?? ''} onChange={(e) => set('privacyUrl', e.target.value)} dir="ltr" /></label>
          <label>Terms URL<input type="url" value={f.termsUrl ?? ''} onChange={(e) => set('termsUrl', e.target.value)} dir="ltr" /></label>
        </div>
        <div className="row">
          <label>Time zone (IANA)<input value={f.timezone} onChange={(e) => set('timezone', e.target.value)} dir="ltr" /></label>
          <label>QR lifetime (s)<input type="number" min={20} max={300} value={f.qrTtlSeconds} onChange={(e) => set('qrTtlSeconds', Number(e.target.value))} /></label>
          <label>Max invoice (agorot)<input type="number" min={100} value={f.maxInvoiceMinor} onChange={(e) => set('maxInvoiceMinor', Number(e.target.value))} /></label>
        </div>
        <ReasonAction label={t('save')} onConfirm={(reason) => save.mutateAsync(reason)} />
        {save.error && <ErrorBox error={save.error} />}
      </div>
    </>
  );
}

function clean(s: Settings) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (v !== null && v !== '') out[k] = v;
  return out;
}
