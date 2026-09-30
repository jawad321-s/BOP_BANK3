import { createContext, useContext } from 'react';
import { tr, type Lang, type StrKey } from '../lib/i18n';

export const LangContext = createContext<Lang>('ar');

export function useLang(): Lang {
  return useContext(LangContext);
}

export function useT() {
  const lang = useLang();
  return (k: StrKey) => tr(k, lang);
}
