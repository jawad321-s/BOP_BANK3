'use client';
import { useRef, useState } from 'react';
import { ApiError } from '@/lib/client';
import { useLang, useT } from './providers';

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const msg = error instanceof ApiError ? `${error.message} (${error.code})` : t('errorGeneric');
  return (
    <div className="error" role="alert">
      {msg} {onRetry && <button className="secondary" onClick={onRetry}>{t('retry')}</button>}
    </div>
  );
}

export function Loading() {
  const t = useT();
  return <p className="muted" role="status">{t('loading')}</p>;
}

export function Empty() {
  const t = useT();
  return <p className="muted">{t('empty')}</p>;
}

export function StatusBadge({ value }: { value: string }) {
  const cls = ['ACTIVE', 'APPROVED', 'CONFIRMED', 'SENT'].includes(value) ? 'ok' : ['PENDING', 'SCHEDULED', 'DRAFT', 'PENDING_ACTIVATION', 'PHOTO_PENDING'].includes(value) ? 'warn' : ['SUSPENDED', 'REVOKED', 'VOIDED', 'EXPIRED', 'REJECTED', 'DELETED', 'CANCELLED'].includes(value) ? 'bad' : '';
  return <span className={`badge ${cls}`}>{value}</span>;
}

/**
 * Accessible confirmation dialog (native <dialog>) that requires a written reason for sensitive actions.
 */
export function ReasonAction({ label, danger, onConfirm, requireReason = true }: { label: string; danger?: boolean; requireReason?: boolean; onConfirm: (reason: string) => Promise<unknown> }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  return (
    <>
      <button className={danger ? 'danger' : 'secondary'} onClick={() => { setErr(null); setReason(''); ref.current?.showModal(); }}>
        {label}
      </button>
      <dialog ref={ref} aria-label={label}>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            try {
              await onConfirm(reason.trim());
              ref.current?.close();
            } catch (x) {
              setErr(x);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>{label}</h3>
          {requireReason && (
            <label>
              {t('reason')}
              <textarea required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
          )}
          {err ? <ErrorBox error={err} /> : null}
          <div className="row">
            <button type="submit" className={danger ? 'danger' : ''} disabled={busy || (requireReason && reason.trim().length < 3)}>{t('confirmAction')}</button>
            <button type="button" className="secondary" onClick={() => ref.current?.close()}>{t('cancel')}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** Minimal bar chart with a data table alternative for screen readers and keyboard users. */
export function BarChart({ title, data, format }: { title: string; data: Array<{ label: string; value: number }>; format?: (n: number) => string }) {
  const lang = useLang();
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure className="card" style={{ margin: 0 }}>
      <figcaption><strong>{title}</strong></figcaption>
      <div className="chart" aria-hidden="true">
        {data.map((d) => (
          <div key={d.label} className="bar" style={{ height: `${(d.value / max) * 100}%` }} title={`${d.label}: ${format ? format(d.value) : d.value}`} />
        ))}
      </div>
      <details>
        <summary>{lang === 'ar' ? 'عرض كجدول' : 'Show as table'}</summary>
        <table>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <th scope="row" className="mono">{d.label}</th>
                <td className="num">{format ? format(d.value) : d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
