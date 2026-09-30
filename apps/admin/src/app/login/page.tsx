'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useT } from '@/components/providers';
import { ErrorBox } from '@/components/ui';

type Step = { kind: 'password' } | { kind: 'mfa' } | { kind: 'enroll'; otpauthUrl: string; secret: string } | { kind: 'codes'; codes: string[] };

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bitaqati-csrf': '1' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j?.error?.message ?? 'Error'), { code: j?.error?.code });
  return j;
}

export default function LoginPage() {
  const t = useT();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (step.kind === 'enroll') QRCode.toDataURL(step.otpauthUrl, { margin: 1, width: 220 }).then(setQr).catch(() => setQr(null));
  }, [step]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="card stack">
        <h2>{t('appName')}</h2>
        {step.kind === 'password' && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(async () => {
            const r = await post('/api/auth/login', { email, password });
            setPassword('');
            setStep(r.status === 'MFA_ENROLLMENT_REQUIRED' ? { kind: 'enroll', otpauthUrl: r.otpauthUrl, secret: r.secret } : { kind: 'mfa' });
          }); }}>
            <label>{t('email')}<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" /></label>
            <label>{t('password')}<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" /></label>
            <button disabled={busy}>{t('continue')}</button>
          </form>
        )}
        {(step.kind === 'mfa' || step.kind === 'enroll') && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void run(async () => {
            const r = await post('/api/auth/mfa', { code, enroll: step.kind === 'enroll' });
            if (r.recoveryCodes) setStep({ kind: 'codes', codes: r.recoveryCodes });
            else window.location.href = '/';
          }); }}>
            {step.kind === 'enroll' && (
              <>
                <p className="notice">{t('mfaEnroll')}</p>
                {qr && <img src={qr} alt="TOTP QR" width={220} height={220} />}
                <p className="mono" style={{ wordBreak: 'break-all' }}>{step.secret}</p>
              </>
            )}
            <label>{t('mfaCode')}<input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" /></label>
            <button disabled={busy}>{t('signIn')}</button>
          </form>
        )}
        {step.kind === 'codes' && (
          <div className="stack">
            <p className="notice">{t('recoveryCodes')}</p>
            <ul className="mono">{step.codes.map((c) => <li key={c}>{c}</li>)}</ul>
            <button onClick={() => (window.location.href = '/')}>{t('continue')}</button>
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </main>
  );
}
