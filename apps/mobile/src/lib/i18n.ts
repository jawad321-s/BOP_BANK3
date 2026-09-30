import { I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';

export type Lang = 'ar' | 'en';

const strings = {
  appName: { ar: 'بطاقتي', en: 'Bitaqati' },
  tagline: { ar: 'خصوماتك في المحلات المشاركة، ببطاقة واحدة.', en: 'Your discounts at partner stores, in one card.' },
  signIn: { ar: 'تسجيل الدخول', en: 'Sign in' },
  signUp: { ar: 'إنشاء حساب', en: 'Create account' },
  browseStores: { ar: 'تصفح المحلات', en: 'Browse stores' },
  email: { ar: 'البريد الإلكتروني', en: 'Email' },
  password: { ar: 'كلمة المرور', en: 'Password' },
  fullName: { ar: 'الاسم الكامل', en: 'Full name' },
  passwordHint: { ar: '10 أحرف على الأقل وتتضمن حروفًا وأرقامًا', en: 'At least 10 characters with letters and numbers' },
  acceptTerms: { ar: 'أوافق على الشروط وسياسة الخصوصية', en: 'I agree to the Terms and Privacy Policy' },
  forgotPassword: { ar: 'نسيت كلمة المرور؟', en: 'Forgot password?' },
  checkEmail: { ar: 'تحقق من بريدك الإلكتروني واتبع الرابط.', en: 'Check your email and follow the link.' },
  resendVerification: { ar: 'إعادة إرسال رابط التأكيد', en: 'Resend confirmation link' },
  newPassword: { ar: 'كلمة المرور الجديدة', en: 'New password' },
  submit: { ar: 'متابعة', en: 'Continue' },
  cancel: { ar: 'إلغاء', en: 'Cancel' },
  retry: { ar: 'إعادة المحاولة', en: 'Try again' },
  loading: { ar: 'جارٍ التحميل…', en: 'Loading…' },
  offline: { ar: 'لا يوجد اتصال بالإنترنت. البيانات المعروضة قد لا تكون محدثة.', en: 'No internet connection. What you see may be out of date.' },
  empty: { ar: 'لا توجد عناصر بعد.', en: 'Nothing here yet.' },
  // tabs
  home: { ar: 'الرئيسية', en: 'Home' },
  stores: { ar: 'المحلات', en: 'Stores' },
  myCard: { ar: 'بطاقتي', en: 'My card' },
  history: { ar: 'سجل الاستخدام', en: 'History' },
  account: { ar: 'الحساب', en: 'Account' },
  // membership
  membership: { ar: 'العضوية', en: 'Membership' },
  state_ACTIVE: { ar: 'فعّالة', en: 'Active' },
  state_PENDING_ACTIVATION: { ar: 'بانتظار التفعيل', en: 'Awaiting activation' },
  state_PHOTO_PENDING: { ar: 'بانتظار اعتماد الصورة', en: 'Photo awaiting approval' },
  state_EXPIRED: { ar: 'اشتراكك منتهٍ', en: 'Membership expired' },
  state_SUSPENDED: { ar: 'البطاقة معلّقة', en: 'Card suspended' },
  state_REVOKED: { ar: 'البطاقة ملغاة', en: 'Card revoked' },
  state_NO_CARD: { ar: 'لا توجد بطاقة', en: 'No card' },
  endsOn: { ar: 'تنتهي في', en: 'Ends on' },
  daysLeft: { ar: 'يوم متبقٍ', en: 'days left' },
  daysLeftHelp: { ar: 'عدد الأيام التقويمية المتبقية حتى منتصف ليل يوم الانتهاء بتوقيت المنصة.', en: 'Calendar days left until midnight of the end date, platform time.' },
  storesUsed: { ar: 'محلات مختلفة', en: 'Different stores' },
  totalUses: { ar: 'إجمالي العمليات', en: 'Total uses' },
  todayUses: { ar: 'عمليات اليوم', en: "Today's uses" },
  totalSavings: { ar: 'إجمالي التوفير', en: 'Total savings' },
  availableToday: { ar: 'متاحة لك اليوم', en: 'Available today' },
  usedToday: { ar: 'استخدمتها اليوم', en: 'Used today' },
  againTomorrow: { ar: 'يمكنك الاستفادة مرة أخرى غدًا', en: 'Available again tomorrow' },
  resetsAt: { ar: 'يتجدد عند', en: 'Resets at' },
  avail_AVAILABLE: { ar: 'متاح اليوم', en: 'Available today' },
  avail_USED_TODAY: { ar: 'مستخدم اليوم', en: 'Used today' },
  avail_CLOSED_NOW: { ar: 'مغلق الآن', en: 'Closed now' },
  avail_STORE_SUSPENDED: { ar: 'المحل موقوف', en: 'Store unavailable' },
  avail_MEMBERSHIP_INACTIVE: { ar: 'اشتراكك غير فعّال', en: 'Membership inactive' },
  avail_SIGNED_OUT: { ar: 'سجّل الدخول للاستفادة', en: 'Sign in to use' },
  // card
  showToCashier: { ar: 'اعرض الرمز على الكاشير', en: 'Show this code to the cashier' },
  qrRefreshIn: { ar: 'يتجدد خلال', en: 'Refreshes in' },
  seconds: { ar: 'ث', en: 's' },
  qrUnavailableOffline: { ar: 'لا يمكن عرض الرمز بدون اتصال. تحقق من الإنترنت.', en: 'The code cannot be shown offline. Check your connection.' },
  serial: { ar: 'الرقم التسلسلي', en: 'Serial number' },
  photoNeeded: { ar: 'أضف صورة شخصية واضحة لتفعيل بطاقتك.', en: 'Add a clear photo of yourself to activate your card.' },
  photoPending: { ar: 'صورتك قيد المراجعة من الإدارة.', en: 'Your photo is being reviewed.' },
  photoRejected: { ar: 'لم تُعتمد الصورة', en: 'Photo not approved' },
  uploadPhoto: { ar: 'رفع صورة', en: 'Upload photo' },
  takePhoto: { ar: 'التقاط صورة', en: 'Take photo' },
  choosePhoto: { ar: 'اختيار من الصور', en: 'Choose from library' },
  awaitingActivation: { ar: 'بطاقتك بانتظار تفعيل الاشتراك من الإدارة.', en: 'Your card is waiting for membership activation.' },
  contactSupport: { ar: 'تواصل مع الدعم', en: 'Contact support' },
  unlockCard: { ar: 'افتح البطاقة', en: 'Unlock card' },
  // approvals
  approveTitle: { ar: 'تأكيد عملية الخصم', en: 'Confirm discount' },
  invoiceTotal: { ar: 'إجمالي الفاتورة', en: 'Invoice total' },
  eligibleAmount: { ar: 'المبلغ المشمول بالخصم', en: 'Eligible amount' },
  discount: { ar: 'الخصم', en: 'Discount' },
  toPay: { ar: 'المطلوب دفعه', en: 'Amount to pay' },
  approve: { ar: 'موافق', en: 'Approve' },
  reject: { ar: 'رفض', en: 'Decline' },
  approvedWaiting: { ar: 'تمت موافقتك. بانتظار تأكيد المحل.', en: 'Approved. Waiting for the store to confirm.' },
  verifyRequestTitle: { ar: 'طلب تحقق من بطاقتك', en: 'Card verification request' },
  verifyRequestBody: { ar: 'وافق فقط إذا كنت موجودًا الآن في هذا المحل.', en: 'Accept only if you are at this store now.' },
  accept: { ar: 'أنا في المحل', en: "I'm at the store" },
  decline: { ar: 'لست أنا', en: 'Not me' },
  // history
  ref: { ar: 'رقم العملية', en: 'Reference' },
  voided: { ar: 'ملغاة', en: 'Voided' },
  confirmed: { ar: 'مؤكدة', en: 'Confirmed' },
  voidReason: { ar: 'سبب الإلغاء', en: 'Void reason' },
  // account
  language: { ar: 'اللغة', en: 'Language' },
  switchLanguage: { ar: 'English', en: 'العربية' },
  restartForLanguage: { ar: 'سيُعاد تشغيل التطبيق لتطبيق اتجاه اللغة.', en: 'The app will restart to apply the language direction.' },
  notifications: { ar: 'الإشعارات', en: 'Notifications' },
  enablePush: { ar: 'تفعيل إشعارات الجهاز', en: 'Enable device notifications' },
  pushDenied: { ar: 'الإشعارات مرفوضة في إعدادات الجهاز. ستظل الإشعارات متاحة داخل التطبيق.', en: 'Notifications are off in device settings. You can still see them in the app.' },
  marketing: { ar: 'عروض ومحلات جديدة (اختياري)', en: 'Offers and new stores (optional)' },
  dailySummary: { ar: 'ملخص يومي بالمحلات المتاحة (اختياري)', en: 'Daily summary of available stores (optional)' },
  expiryReminders: { ar: 'تذكير قبل انتهاء الاشتراك', en: 'Reminder before membership ends' },
  devices: { ar: 'الأجهزة المسجّلة', en: 'Signed-in devices' },
  thisDevice: { ar: 'هذا الجهاز', en: 'This device' },
  signOutOthers: { ar: 'تسجيل الخروج من الأجهزة الأخرى', en: 'Sign out other devices' },
  cardLock: { ar: 'قفل البطاقة ببصمة الوجه/الإصبع', en: 'Lock card with Face ID / Touch ID' },
  cardLockHelp: { ar: 'طبقة إضافية على هذا الجهاز فقط، ولا تثبت هوية صاحب البطاقة للمحل.', en: 'An extra layer on this device only; it does not prove identity to the store.' },
  support: { ar: 'الدعم', en: 'Support' },
  privacy: { ar: 'سياسة الخصوصية', en: 'Privacy policy' },
  terms: { ar: 'الشروط والأحكام', en: 'Terms' },
  signOut: { ar: 'تسجيل الخروج', en: 'Sign out' },
  deleteAccount: { ar: 'حذف الحساب', en: 'Delete account' },
  deleteExplain: {
    ar: 'سيتم فورًا: إلغاء بطاقتك واشتراكك، تسجيل الخروج من كل الأجهزة، وحذف صورتك واسمك وإشعاراتك. تبقى سجلات عمليات الخصم لدى المحلات دون بياناتك الشخصية لأغراض محاسبية. تُحذف النسخ الاحتياطية تلقائيًا خلال 35 يومًا. لا يمكن التراجع.',
    en: 'Immediately: your card and membership are cancelled, all devices are signed out, and your photo, name and notifications are deleted. Discount records kept by stores remain without your personal data for accounting. Backups roll off within 35 days. This cannot be undone.',
  },
  typeDelete: { ar: 'اكتب DELETE للتأكيد', en: 'Type DELETE to confirm' },
  switchToMerchant: { ar: 'مساحة المحل', en: 'Store workspace' },
  switchToUser: { ar: 'مساحة العضو', en: 'Member workspace' },
  // merchant
  dashboard: { ar: 'لوحة المحل', en: 'Dashboard' },
  scan: { ar: 'المسح', en: 'Scan' },
  transactions: { ar: 'العمليات', en: 'Transactions' },
  staff: { ar: 'الموظفون', en: 'Staff' },
  settings: { ar: 'الإعدادات', en: 'Settings' },
  branch: { ar: 'الفرع', en: 'Branch' },
  chooseBranch: { ar: 'اختر الفرع', en: 'Choose branch' },
  cameraDenied: { ar: 'لا يمكن الوصول للكاميرا. يمكنك إدخال الرقم التسلسلي يدويًا أو السماح بالكاميرا من الإعدادات.', en: 'Camera access is off. Enter the serial manually or allow the camera in Settings.' },
  openSettings: { ar: 'فتح الإعدادات', en: 'Open Settings' },
  allowCamera: { ar: 'السماح بالكاميرا', en: 'Allow camera' },
  manualEntry: { ar: 'إدخال يدوي', en: 'Manual entry' },
  manualHelp: { ar: 'سيُطلب من العميل التأكيد من تطبيقه قبل ظهور صورته.', en: 'The customer must confirm in their app before their photo is shown.' },
  waitingCustomer: { ar: 'بانتظار تأكيد العميل من تطبيقه…', en: 'Waiting for the customer to confirm in their app…' },
  compareFace: { ar: 'قارن الصورة بالشخص الموجود أمامك', en: 'Compare the photo with the person in front of you' },
  match: { ar: 'مطابق', en: 'Matches' },
  mismatch: { ar: 'غير مطابق', en: 'Does not match' },
  alreadyUsedWarning: { ar: 'استُخدمت هذه البطاقة في هذا المحل اليوم.', en: 'This card was already used at this store today.' },
  enterInvoice: { ar: 'إجمالي الفاتورة (₪)', en: 'Invoice total (₪)' },
  partialEligible: { ar: 'جزء من الفاتورة غير مشمول', en: 'Part of the invoice is excluded' },
  eligibleReason: { ar: 'سبب الاستثناء', en: 'Reason for exclusion' },
  calculate: { ar: 'احسب الخصم', en: 'Calculate discount' },
  waitingApproval: { ar: 'بانتظار موافقة العميل من تطبيقه…', en: 'Waiting for the customer to approve in their app…' },
  customerRejected: { ar: 'رفض العميل العملية.', en: 'The customer declined.' },
  confirmUse: { ar: 'تأكيد استخدام الخصم', en: 'Confirm discount use' },
  recorded: { ar: 'تم التسجيل', en: 'Recorded' },
  checkingStatus: { ar: 'انقطع الاتصال. جارٍ التحقق من حالة العملية نفسها…', en: 'Connection lost. Checking the status of this same transaction…' },
  newScan: { ar: 'عملية جديدة', en: 'New transaction' },
  period_today: { ar: 'اليوم', en: 'Today' },
  period_week: { ar: 'الأسبوع', en: 'Week' },
  period_month: { ar: 'الشهر', en: 'Month' },
  period_year: { ar: 'السنة', en: 'Year' },
  distinctCustomers: { ar: 'عملاء مختلفون', en: 'Distinct customers' },
  recordedAmounts: { ar: 'مبالغ عمليات الخصم المسجلة (ليست مدفوعات محصّلة)', en: 'Recorded discount transaction amounts (not collected payments)' },
  grossTotal: { ar: 'الفواتير قبل الخصم', en: 'Invoices before discount' },
  discountTotal: { ar: 'مجموع الخصومات', en: 'Total discounts' },
  netTotal: { ar: 'بعد الخصم', en: 'After discount' },
  invite: { ar: 'دعوة موظف', en: 'Invite staff' },
  deactivate: { ar: 'إيقاف', en: 'Deactivate' },
  reactivate: { ar: 'إعادة تفعيل', en: 'Reactivate' },
  invitationSent: { ar: 'تم إنشاء الدعوة.', en: 'Invitation created.' },
  emailNotSent: { ar: 'تم إنشاء الدعوة لكن لم يُرسل البريد. تواصل مع الإدارة.', en: 'Invitation created but the email was not sent. Contact admin.' },
  nearMe: { ar: 'قريب مني', en: 'Near me' },
  locationDenied: { ar: 'لم يُسمح بالموقع. يمكنك اختيار المدينة يدويًا.', en: 'Location not allowed. You can pick a city instead.' },
  allCities: { ar: 'كل المدن', en: 'All cities' },
  allCategories: { ar: 'كل التصنيفات', en: 'All categories' },
  searchStores: { ar: 'ابحث عن محل', en: 'Search stores' },
  directions: { ar: 'الاتجاهات', en: 'Directions' },
  call: { ar: 'اتصال', en: 'Call' },
  openingHours: { ar: 'ساعات العمل', en: 'Opening hours' },
  offerTerms: { ar: 'شروط العرض', en: 'Offer terms' },
  maxDiscount: { ar: 'حد أقصى للخصم', en: 'Maximum discount' },
  minPurchase: { ar: 'حد أدنى للمبلغ المؤهل', en: 'Minimum eligible amount' },
  sessionEnded: { ar: 'انتهت الجلسة، يرجى تسجيل الدخول مجددًا.', en: 'Your session has ended. Please sign in again.' },
  notificationCenter: { ar: 'مركز الإشعارات', en: 'Notification center' },
  markAllRead: { ar: 'تعليم الكل كمقروء', en: 'Mark all read' },
  profile: { ar: 'البيانات الشخصية', en: 'Profile' },
  save: { ar: 'حفظ', en: 'Save' },
  changePassword: { ar: 'تغيير كلمة المرور', en: 'Change password' },
  currentPassword: { ar: 'كلمة المرور الحالية', en: 'Current password' },
  invitationAccept: { ar: 'قبول الدعوة', en: 'Accept invitation' },
  haveToken: { ar: 'لديك رمز من البريد؟', en: 'Have a code from email?' },
  pasteToken: { ar: 'الصق الرمز أو الرابط', en: 'Paste code or link' },
  weekday_0: { ar: 'الأحد', en: 'Sun' },
  weekday_1: { ar: 'الإثنين', en: 'Mon' },
  weekday_2: { ar: 'الثلاثاء', en: 'Tue' },
  weekday_3: { ar: 'الأربعاء', en: 'Wed' },
  weekday_4: { ar: 'الخميس', en: 'Thu' },
  weekday_5: { ar: 'الجمعة', en: 'Fri' },
  weekday_6: { ar: 'السبت', en: 'Sat' },
} as const;

export type StrKey = keyof typeof strings;

let current: Lang = I18nManager.isRTL ? 'ar' : 'en';
const LANG_KEY = 'bitaqati.lang';

export async function loadLanguage(): Promise<Lang> {
  const stored = (await AsyncStorage.getItem(LANG_KEY)) as Lang | null;
  const device = Localization.getLocales()[0]?.languageCode === 'en' ? 'en' : 'ar';
  current = stored ?? (device === 'en' ? 'en' : 'ar'); // Arabic first
  return current;
}

export function getLang(): Lang {
  return current;
}

/** Persists the language and aligns layout direction. Returns true if a restart is required. */
export async function setLanguage(lang: Lang): Promise<boolean> {
  await AsyncStorage.setItem(LANG_KEY, lang);
  current = lang;
  const wantRTL = lang === 'ar';
  I18nManager.allowRTL(true);
  if (I18nManager.isRTL !== wantRTL) {
    I18nManager.forceRTL(wantRTL);
    return true;
  }
  return false;
}

export function tr(key: StrKey, lang: Lang = current): string {
  return strings[key][lang];
}
