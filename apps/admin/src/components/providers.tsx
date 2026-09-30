'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useState } from 'react';
import { t as translate, type Key, type Lang } from '@/lib/i18n';
import { ApiError } from '@/lib/client';

const LangCtx = createContext<Lang>('ar');

export function Providers({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, refetchOnWindowFocus: true, staleTime: 10_000 },
        },
      }),
  );
  return (
    <LangCtx.Provider value={lang}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </LangCtx.Provider>
  );
}

export function useLang(): Lang {
  return useContext(LangCtx);
}

export function useT() {
  const lang = useLang();
  return (k: Key) => translate(k, lang);
}
