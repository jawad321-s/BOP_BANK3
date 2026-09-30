import { formatILS, formatRateBps } from '@bitaqati/shared';
import type { Lang } from './i18n';

export const money = (minor: number, lang: Lang) => formatILS(minor, lang);
export const rate = (bps: number | null | undefined) => (bps == null ? '—' : formatRateBps(bps));
const loc = (lang: Lang) => (lang === 'ar' ? 'ar-PS-u-nu-latn' : 'en-GB');
export const dateTime = (iso: string, lang: Lang, timeZone = 'Asia/Hebron') => new Intl.DateTimeFormat(loc(lang), { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
export const timeOnly = (iso: string, lang: Lang, timeZone = 'Asia/Hebron') => new Intl.DateTimeFormat(loc(lang), { timeStyle: 'short', timeZone }).format(new Date(iso));
export const dateOnly = (iso: string, lang: Lang, timeZone = 'Asia/Hebron') => new Intl.DateTimeFormat(loc(lang), { dateStyle: 'medium', timeZone }).format(new Date(iso));
/** Keeps Latin serials/refs readable inside RTL text. */
export const ltr = (s: string) => `⁦${s}⁩`;
