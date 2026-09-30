import { z } from 'zod';
import { ADMIN_PERMISSIONS } from './enums';
import { isValidTimeZone } from './time';

const email = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(10, 'min 10')
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'letters and digits');

export const localeSchema = z.enum(['ar', 'en']);
const uuid = z.string().uuid();
const minor = z.number().int().positive().max(1_000_000_000);

export const registerSchema = z.object({
  email,
  password: passwordSchema,
  fullName: z.string().trim().min(2).max(100),
  locale: localeSchema.default('ar'),
  acceptTerms: z.literal(true),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
  deviceName: z.string().trim().max(100).optional(),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const mfaVerifySchema = z.object({
  challengeToken: z.string().min(10).max(500),
  code: z.string().trim().min(6).max(20),
});

export const mfaEnrollConfirmSchema = z.object({
  challengeToken: z.string().min(10).max(500),
  code: z.string().trim().regex(/^\d{6}$/),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(500) });
export const emailOnlySchema = z.object({ email });
export const tokenSchema = z.object({ token: z.string().min(20).max(500) });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(500), password: passwordSchema });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema });
export const changeEmailSchema = z.object({ newEmail: email, password: z.string().min(1).max(128) });
export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(500),
  fullName: z.string().trim().min(2).max(100).optional(),
  password: passwordSchema.optional(),
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  locale: localeSchema.optional(),
});

export const deletionRequestSchema = z.object({
  password: z.string().min(1).max(128),
  confirm: z.literal('DELETE'),
});

export const notificationPrefsSchema = z.object({
  marketing: z.boolean().optional(),
  dailySummary: z.boolean().optional(),
  expiryReminders: z.boolean().optional(),
});

export const pushTokenSchema = z.object({
  token: z.string().min(10).max(300),
  platform: z.enum(['ios', 'android']),
});

export const paginationSchema = z.object({
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const usageQuerySchema = paginationSchema.extend({
  from: dateStr.optional(),
  to: dateStr.optional(),
  status: z.enum(['CONFIRMED', 'VOIDED']).optional(),
});

export const storesQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  categoryId: uuid.optional(),
  city: z.string().trim().max(80).optional(),
  minRateBps: z.coerce.number().int().min(0).max(10000).optional(),
  availability: z.enum(['AVAILABLE', 'USED_TODAY']).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

// ---- merchant flow ----
export const createVerificationSchema = z
  .object({
    branchId: uuid,
    qrPayload: z.string().trim().max(200).optional(),
    serialNumber: z.string().trim().max(40).optional(),
  })
  .refine((v) => !!v.qrPayload !== !!v.serialNumber, { message: 'exactly one of qrPayload or serialNumber' });

export const matchDecisionSchema = z.object({ decision: z.enum(['MATCH', 'MISMATCH']) });

export const createQuoteSchema = z
  .object({
    verificationId: uuid,
    grossMinor: minor,
    eligibleMinor: minor.optional(),
    eligibleReason: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.eligibleMinor === undefined || v.eligibleMinor === v.grossMinor || !!v.eligibleReason, {
    message: 'eligibleReason required when eligible amount differs',
    path: ['eligibleReason'],
  });

export const approvalDecisionSchema = z.object({
  /** Fingerprint of the quote the user saw. Any change in amounts/offer invalidates it. */
  fingerprint: z.string().min(16).max(128),
});

export const confirmRedemptionSchema = z.object({ quoteId: uuid });

export const merchantReportQuerySchema = z.object({
  storeId: uuid.optional(),
  branchId: uuid.optional(),
  period: z.enum(['today', 'week', 'month', 'year', 'custom']).default('today'),
  from: dateStr.optional(),
  to: dateStr.optional(),
});

export const merchantRedemptionsQuerySchema = paginationSchema.extend({
  storeId: uuid.optional(),
  branchId: uuid.optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  status: z.enum(['CONFIRMED', 'VOIDED']).optional(),
});

export const inviteStaffSchema = z.object({
  email,
  storeId: uuid,
  branchIds: z.array(uuid).min(1).max(100),
});

export const updateStaffBranchesSchema = z.object({ branchIds: z.array(uuid).min(1).max(100) });

// ---- admin ----
export const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const adminUsersQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  photoStatus: z.enum(['NONE', 'PENDING', 'APPROVED', 'REJECTED']).optional(),
  membership: z.enum(['ACTIVE', 'EXPIRED', 'NONE']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
});

export const photoReviewSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('APPROVE') }),
  z.object({ decision: z.literal('REJECT'), reason: z.string().trim().min(3).max(300) }),
]);

export const cardActionSchema = z.object({
  action: z.enum(['ISSUE', 'ACTIVATE', 'SUSPEND', 'REACTIVATE', 'REPLACE', 'REVOKE']),
  reason: z.string().trim().min(3).max(500),
});

export const grantSubscriptionSchema = z.object({
  planId: uuid,
  startsAt: z.string().datetime().optional(),
  reason: z.string().trim().min(3).max(500),
  /** Admin confirms payment was verified out-of-band; the client never grants time by claiming payment. */
  paymentReference: z.string().trim().max(120).optional(),
});

export const cancelSubscriptionSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const planSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_]{2,40}$/),
  nameAr: z.string().trim().min(2).max(100),
  nameEn: z.string().trim().min(2).max(100),
  durationDays: z.number().int().min(1).max(1100),
  priceMinor: z.number().int().min(0).max(100_000_000),
  active: z.boolean().default(true),
});

const localizedText = { ar: z.string().trim().min(1).max(200), en: z.string().trim().min(1).max(200) };

export const merchantSchema = z.object({
  nameAr: localizedText.ar,
  nameEn: localizedText.en,
  legalName: z.string().trim().max(200).optional(),
  contactEmail: email.optional(),
  contactPhone: z.string().trim().max(30).optional(),
});

export const categorySchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9-]{2,40}$/),
  nameAr: localizedText.ar,
  nameEn: localizedText.en,
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

export const storeSchema = z.object({
  merchantId: uuid,
  categoryId: uuid,
  nameAr: localizedText.ar,
  nameEn: localizedText.en,
  descriptionAr: z.string().trim().max(2000).default(''),
  descriptionEn: z.string().trim().max(2000).default(''),
  phone: z.string().trim().max(30).optional(),
  website: z.string().trim().url().max(300).optional(),
  instagram: z.string().trim().max(100).optional(),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/);
export const openingHoursSchema = z
  .array(z.object({ day: z.number().int().min(0).max(6), open: hhmm, close: hhmm }))
  .max(28);

export const branchSchema = z.object({
  nameAr: localizedText.ar,
  nameEn: localizedText.en,
  city: z.string().trim().min(2).max(80),
  addressAr: z.string().trim().max(300).default(''),
  addressEn: z.string().trim().max(300).default(''),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  phone: z.string().trim().max(30).optional(),
  openingHours: openingHoursSchema.default([]),
});

export const offerSchema = z.object({
  rateBps: z.number().int().min(1).max(10000),
  minEligibleMinor: z.number().int().min(1).max(1_000_000_000).nullable().optional(),
  maxDiscountMinor: z.number().int().min(1).max(1_000_000_000).nullable().optional(),
  termsAr: z.string().trim().max(2000).default(''),
  termsEn: z.string().trim().max(2000).default(''),
  reason: z.string().trim().min(3).max(500),
});

export const statusChangeSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  reason: z.string().trim().min(3).max(500),
});

export const inviteSchema = z.object({
  email,
  kind: z.enum(['MERCHANT_OWNER', 'MERCHANT_STAFF', 'ADMIN']),
  merchantId: uuid.optional(),
  storeId: uuid.optional(),
  branchIds: z.array(uuid).max(100).optional(),
  permissions: z.array(z.enum(ADMIN_PERMISSIONS)).max(ADMIN_PERMISSIONS.length).optional(),
});

export const adminRedemptionsQuerySchema = paginationSchema.extend({
  ref: z.string().trim().max(40).optional(),
  userId: uuid.optional(),
  userEmail: z.string().trim().max(254).optional(),
  storeId: uuid.optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  status: z.enum(['CONFIRMED', 'VOIDED']).optional(),
});

export const reportQuerySchema = z.object({
  from: dateStr,
  to: dateStr,
  storeId: uuid.optional(),
  branchId: uuid.optional(),
  granularity: z.enum(['day', 'week', 'month']).default('day'),
});

export const audienceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ALL_USERS') }),
  z.object({ kind: z.literal('ACTIVE_MEMBERS') }),
  z.object({ kind: z.literal('EXPIRING_WITHIN_DAYS'), days: z.number().int().min(1).max(60) }),
  z.object({ kind: z.literal('CITY'), city: z.string().trim().min(2).max(80) }),
]);
export type Audience = z.infer<typeof audienceSchema>;

export const broadcastSchema = z.object({
  titleAr: z.string().trim().min(1).max(80),
  titleEn: z.string().trim().min(1).max(80),
  bodyAr: z.string().trim().min(1).max(300),
  bodyEn: z.string().trim().min(1).max(300),
  audience: audienceSchema,
  /** Marketing broadcasts only reach users who opted in to marketing notifications. */
  marketing: z.boolean().default(true),
  scheduledAt: z.string().datetime().optional(),
});

export const settingsSchema = z.object({
  appNameAr: z.string().trim().min(1).max(60).optional(),
  appNameEn: z.string().trim().min(1).max(60).optional(),
  supportEmail: z.string().trim().email().optional(),
  supportPhone: z.string().trim().max(30).optional(),
  privacyUrl: z.string().trim().url().optional(),
  termsUrl: z.string().trim().url().optional(),
  timezone: z.string().refine(isValidTimeZone, 'invalid time zone').optional(),
  qrTtlSeconds: z.number().int().min(20).max(300).optional(),
  maxInvoiceMinor: z.number().int().min(100).max(1_000_000_000).optional(),
  reason: z.string().trim().min(3).max(500),
});
