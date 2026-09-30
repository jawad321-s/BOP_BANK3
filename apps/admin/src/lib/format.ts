import { formatILS, formatRateBps } from '@bitaqati/shared';
import type { Lang } from './i18n';

export const money = (minor: number, lang: Lang) => formatILS(minor, lang);
export const rate = (bps: number) => formatRateBps(bps);
export const dateTime = (iso: string | null | undefined, lang: Lang, timeZone = 'Asia/Hebron') =>
  iso ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-PS-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso)) : '—';
export const dateOnly = (iso: string, lang: Lang) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-PS-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));
export { todayIn, shiftDate } from './dates';
