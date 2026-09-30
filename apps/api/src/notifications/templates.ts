import { formatILS } from '@bitaqati/shared';

export interface Rendered {
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
}

/**
 * Notification copy. Push text never contains photos, serial numbers, or other sensitive data
 * (it may appear on the lock screen).
 */
export const templates = {
  REDEMPTION_CONFIRMED: (p: { storeAr: string; storeEn: string; discountMinor: number }): Rendered => ({
    titleAr: 'تم تسجيل الخصم',
    titleEn: 'Discount recorded',
    bodyAr: `وفّرت ${formatILS(p.discountMinor, 'ar')} في ${p.storeAr}.`,
    bodyEn: `You saved ${formatILS(p.discountMinor, 'en')} at ${p.storeEn}.`,
  }),
  REDEMPTION_VOIDED: (p: { storeAr: string; storeEn: string }): Rendered => ({
    titleAr: 'تم إلغاء عملية',
    titleEn: 'Transaction voided',
    bodyAr: `ألغت الإدارة عملية خصم في ${p.storeAr}. التفاصيل في سجل الاستخدام.`,
    bodyEn: `An admin voided a discount at ${p.storeEn}. See your history for details.`,
  }),
  APPROVAL_REQUEST: (p: { storeAr: string; storeEn: string }): Rendered => ({
    titleAr: 'طلب موافقة على خصم',
    titleEn: 'Approve your discount',
    bodyAr: `راجع تفاصيل العملية في ${p.storeAr} ووافق عليها داخل التطبيق.`,
    bodyEn: `Review the transaction at ${p.storeEn} and approve it in the app.`,
  }),
  VERIFICATION_REQUEST: (p: { storeAr: string; storeEn: string }): Rendered => ({
    titleAr: 'طلب تحقق من بطاقتك',
    titleEn: 'Card verification request',
    bodyAr: `يطلب ${p.storeAr} التحقق من بطاقتك. وافق فقط إذا كنت موجودًا في المحل.`,
    bodyEn: `${p.storeEn} is asking to verify your card. Accept only if you are at the store.`,
  }),
  MEMBERSHIP_ACTIVATED: (): Rendered => ({
    titleAr: 'تم تفعيل اشتراكك',
    titleEn: 'Membership active',
    bodyAr: 'اشتراكك فعّال الآن. استمتع بخصوماتك.',
    bodyEn: 'Your membership is now active.',
  }),
  MEMBERSHIP_EXPIRING: (p: { days: number }): Rendered => ({
    titleAr: 'اشتراكك ينتهي قريبًا',
    titleEn: 'Membership ending soon',
    bodyAr: `يتبقى ${p.days} ${p.days === 1 ? 'يوم' : 'أيام'} على انتهاء اشتراكك.`,
    bodyEn: `Your membership ends in ${p.days} day${p.days === 1 ? '' : 's'}.`,
  }),
  MEMBERSHIP_EXPIRED: (): Rendered => ({
    titleAr: 'انتهى اشتراكك',
    titleEn: 'Membership ended',
    bodyAr: 'انتهى اشتراكك. تواصل مع الدعم للتجديد.',
    bodyEn: 'Your membership has ended. Contact support to renew.',
  }),
  PHOTO_APPROVED: (): Rendered => ({ titleAr: 'تم اعتماد صورتك', titleEn: 'Photo approved', bodyAr: 'تم اعتماد صورتك الشخصية.', bodyEn: 'Your profile photo was approved.' }),
  PHOTO_REJECTED: (): Rendered => ({ titleAr: 'لم تُعتمد صورتك', titleEn: 'Photo not approved', bodyAr: 'يرجى رفع صورة أوضح. السبب في التطبيق.', bodyEn: 'Please upload a clearer photo. See the app for details.' }),
  DAILY_SUMMARY: (p: { count: number }): Rendered => ({
    titleAr: 'خصوماتك متاحة اليوم',
    titleEn: 'Your discounts are available',
    bodyAr: `${p.count} محل متاح لك اليوم.`,
    bodyEn: `${p.count} stores are available to you today.`,
  }),
};
