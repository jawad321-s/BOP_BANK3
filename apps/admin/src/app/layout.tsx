import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = { title: 'Bitaqati Admin', robots: { index: false, follow: false } };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = (await cookies()).get('bq_lang')?.value === 'en' ? 'en' : 'ar';
  return (
    <html lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <body>
        <Providers lang={lang}>{children}</Providers>
      </body>
    </html>
  );
}
