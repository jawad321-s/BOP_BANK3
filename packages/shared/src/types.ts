import type { CardStatus, MembershipState, PhotoStatus, StoreAvailability, VerificationStatus, QuoteStatus, RedemptionStatus, MerchantRole, AdminPermission } from './enums';

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export type LoginResponse =
  | ({ status: 'OK' } & AuthTokens)
  | { status: 'MFA_REQUIRED'; challengeToken: string }
  | { status: 'MFA_ENROLLMENT_REQUIRED'; challengeToken: string; otpauthUrl: string; secret: string };

export interface Workspaces {
  user: true;
  merchant: Array<{
    membershipId: string;
    merchantId: string;
    merchantName: { ar: string; en: string };
    role: MerchantRole;
    stores: Array<{ id: string; name: { ar: string; en: string }; branches: Array<{ id: string; name: { ar: string; en: string } }> }>;
  }>;
  admin: { permissions: AdminPermission[] } | null;
}

export interface MeResponse {
  id: string;
  email: string;
  emailVerified: boolean;
  fullName: string;
  locale: 'ar' | 'en';
  photoStatus: PhotoStatus;
  photoRejectReason: string | null;
  workspaces: Workspaces;
}

export interface MembershipSummary {
  state: MembershipState;
  cardStatus: CardStatus | null;
  subscriptionEndsAt: string | null;
  /** Whole calendar days remaining in the platform time zone; 0 on the last day. */
  daysRemaining: number | null;
  planName: { ar: string; en: string } | null;
}

export interface HomeResponse {
  fullName: string;
  membership: MembershipSummary;
  stats: {
    distinctStoresUsed: number;
    totalRedemptions: number;
    todayRedemptions: number;
    totalSavingsMinor: number;
  };
  businessDate: string;
  timezone: string;
  nextResetAt: string;
  serverTime: string;
  availableToday: StoreSummary[];
  usedToday: Array<StoreSummary & { redeemedAt: string; redemptionRef: string }>;
}

export interface StoreSummary {
  id: string;
  name: { ar: string; en: string };
  category: { id: string; name: { ar: string; en: string } } | null;
  logoUrl: string | null;
  rateBps: number | null;
  cities: string[];
  availability: StoreAvailability;
  openNow: boolean | null;
}

export interface BranchDetail {
  id: string;
  name: { ar: string; en: string };
  city: string;
  address: { ar: string; en: string };
  lat: number | null;
  lng: number | null;
  phone: string | null;
  openingHours: Array<{ day: number; open: string; close: string }>;
  openNow: boolean | null;
}

export interface StoreDetail extends StoreSummary {
  description: { ar: string; en: string };
  images: string[];
  phone: string | null;
  website: string | null;
  instagram: string | null;
  offer: { rateBps: number; minEligibleMinor: number | null; maxDiscountMinor: number | null; terms: { ar: string; en: string } } | null;
  branches: BranchDetail[];
}

export interface CardResponse {
  membership: MembershipSummary;
  card: {
    id: string;
    serialNumber: string;
    status: CardStatus;
    issuedAt: string;
  } | null;
  holderName: string;
  photoStatus: PhotoStatus;
  hasApprovedPhoto: boolean;
  canShowQr: boolean;
}

export interface QrTokenResponse {
  payload: string;
  expiresAt: string;
  ttlSeconds: number;
  serverTime: string;
}

export interface RedemptionView {
  id: string;
  ref: string;
  status: RedemptionStatus;
  store: { id: string; name: { ar: string; en: string } };
  branch: { id: string; name: { ar: string; en: string } };
  businessDate: string;
  timezone: string;
  confirmedAt: string;
  grossMinor: number;
  eligibleMinor: number;
  rateBps: number;
  discountMinor: number;
  netMinor: number;
  currency: 'ILS';
  voidedAt: string | null;
  voidReason: string | null;
  customerName?: string;
  staffName?: string;
}

export interface VerificationView {
  id: string;
  status: VerificationStatus;
  method: 'QR' | 'MANUAL';
  expiresAt: string;
  store: { id: string; name: { ar: string; en: string } };
  branch: { id: string; name: { ar: string; en: string } };
  /** Only present once the holder is confirmed present (QR scan, or user accepted a manual lookup). */
  holder: { fullName: string; photoAvailable: boolean; serialNumber: string } | null;
  membershipState: MembershipState | null;
  alreadyRedeemedToday: boolean;
  offer: { rateBps: number; minEligibleMinor: number | null; maxDiscountMinor: number | null; terms: { ar: string; en: string } } | null;
  currentQuote: QuoteView | null;
  redemption: RedemptionView | null;
}

export interface QuoteView {
  id: string;
  status: QuoteStatus;
  grossMinor: number;
  eligibleMinor: number;
  eligibleReason: string | null;
  rateBps: number;
  discountMinor: number;
  netMinor: number;
  capped: boolean;
  expiresAt: string;
  fingerprint: string;
  store: { id: string; name: { ar: string; en: string } };
  branch: { id: string; name: { ar: string; en: string } };
  terms: { ar: string; en: string };
}

export interface MerchantDashboard {
  period: { from: string; to: string };
  timezone: string;
  distinctCustomers: number;
  redemptions: number;
  grossMinor: number;
  discountMinor: number;
  netMinor: number;
  distinctCustomersToday: number;
  redemptionsToday: number;
}
