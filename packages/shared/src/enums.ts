export const CARD_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const PHOTO_STATUSES = ['NONE', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type PhotoStatus = (typeof PHOTO_STATUSES)[number];

export const MERCHANT_ROLES = ['OWNER', 'STAFF'] as const;
export type MerchantRole = (typeof MERCHANT_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  'USERS_MANAGE',
  'PHOTOS_REVIEW',
  'MERCHANTS_MANAGE',
  'OFFERS_MANAGE',
  'SUBSCRIPTIONS_MANAGE',
  'REDEMPTIONS_VIEW',
  'REDEMPTIONS_VOID',
  'NOTIFICATIONS_SEND',
  'REPORTS_VIEW',
  'SETTINGS_MANAGE',
  'ADMINS_MANAGE',
  'AUDIT_VIEW',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const REDEMPTION_STATUSES = ['CONFIRMED', 'VOIDED'] as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUSES)[number];

export const QUOTE_STATUSES = ['AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'EXPIRED', 'CONSUMED'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const VERIFICATION_STATUSES = [
  'AWAITING_USER',
  'PENDING_MATCH',
  'MATCHED',
  'MISMATCHED',
  'DECLINED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Card eligibility as shown to users and merchants — derived from card, subscription, photo and time together. */
export const MEMBERSHIP_STATES = ['ACTIVE', 'PENDING_ACTIVATION', 'PHOTO_PENDING', 'EXPIRED', 'SUSPENDED', 'REVOKED', 'NO_CARD'] as const;
export type MembershipState = (typeof MEMBERSHIP_STATES)[number];

/** Per-store availability for the current user today. Kept distinct so the UI never conflates them. */
export const STORE_AVAILABILITY = ['AVAILABLE', 'USED_TODAY', 'CLOSED_NOW', 'STORE_SUSPENDED', 'MEMBERSHIP_INACTIVE', 'SIGNED_OUT'] as const;
export type StoreAvailability = (typeof STORE_AVAILABILITY)[number];

export const NOTIFICATION_TYPES = [
  'REDEMPTION_CONFIRMED',
  'REDEMPTION_VOIDED',
  'MEMBERSHIP_EXPIRING',
  'MEMBERSHIP_EXPIRED',
  'MEMBERSHIP_ACTIVATED',
  'PHOTO_APPROVED',
  'PHOTO_REJECTED',
  'APPROVAL_REQUEST',
  'VERIFICATION_REQUEST',
  'DAILY_SUMMARY',
  'BROADCAST',
  'MERCHANT_REDEMPTION',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
