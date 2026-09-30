'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client';
import { useLang, useT } from '@/components/providers';
import type { Key } from '@/lib/i18n';

const NAV: Array<{ href: string; key: Key; perm?: string }> = [
  { href: '/', key: 'dashboard', perm: 'REPORTS_VIEW' },
  { href: '/users', key: 'users', perm: 'USERS_MANAGE' },
  { href: '/merchants', key: 'merchants', perm: 'MERCHANTS_MANAGE' },
  { href: '/plans', key: 'plans', perm: 'SUBSCRIPTIONS_MANAGE' },
  { href: '/redemptions', key: 'redemptions', perm: 'REDEMPTIONS_VIEW' },
  { href: '/notifications', key: 'notifications', perm: 'NOTIFICATIONS_SEND' },
  { href: '/settings', key: 'settings', perm: 'SETTINGS_MANAGE' },
  { href: '/audit', key: 'audit', perm: 'AUDIT_VIEW' },
];

async function post(path: string, body: unknown) {
  await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bitaqati-csrf': '1' }, body: JSON.stringify(body) });
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  const lang = useLang();
  const path = usePathname();
  // Navigation is filtered for convenience only; the API enforces every permission server-side.
  const me = useQuery({ queryKey: ['admin-me'], queryFn: () => api<{ permissions: string[] }>('/v1/admin/me') });
  const perms = new Set(me.data?.permissions ?? []);
  return (
    <div className="shell">
      <nav className="side" aria-label="main">
        <h1>{t('appName')}</h1>
        {NAV.filter((n) => !n.perm || perms.has(n.perm)).map((n) => (
          <Link key={n.href} href={n.href} aria-current={path === n.href || (n.href !== '/' && path.startsWith(n.href)) ? 'page' : undefined}>
            {t(n.key)}
          </Link>
        ))}
        <div className="spacer" />
        <button onClick={() => post('/api/lang', { lang: lang === 'ar' ? 'en' : 'ar' }).then(() => window.location.reload())}>{lang === 'ar' ? 'English' : 'العربية'}</button>
        <button onClick={() => post('/api/auth/logout', {}).then(() => (window.location.href = '/login'))}>{t('logout')}</button>
      </nav>
      <main>{children}</main>
    </div>
  );
}
