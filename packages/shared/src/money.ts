/**
 * Money helpers. All ILS amounts are integer minor units (agorot): 100 agorot = 1 ₪.
 * Rates are integer basis points: 2000 bps = 20%.
 * Floating point is never used for money.
 */

export const CURRENCY = 'ILS' as const;
export const MINOR_PER_MAJOR = 100;
export const BPS_DENOMINATOR = 10_000;
export const MAX_RATE_BPS = 10_000;

export interface OfferRules {
  rateBps: number;
  /** Optional: eligible amount must be at least this much (minor units). */
  minEligibleMinor?: number | null;
  /** Optional: discount is capped at this amount (minor units). */
  maxDiscountMinor?: number | null;
}

export interface DiscountInput extends OfferRules {
  grossMinor: number;
  eligibleMinor: number;
  /** Operational ceiling for a single invoice (minor units). */
  maxInvoiceMinor: number;
}

export interface DiscountResult {
  grossMinor: number;
  eligibleMinor: number;
  rateBps: number;
  discountMinor: number;
  netMinor: number;
  capped: boolean;
}

export type DiscountErrorCode =
  | 'INVALID_AMOUNT'
  | 'AMOUNT_TOO_LARGE'
  | 'ELIGIBLE_EXCEEDS_GROSS'
  | 'INVALID_RATE'
  | 'BELOW_MINIMUM';

export class DiscountCalculationError extends Error {
  constructor(public readonly code: DiscountErrorCode) {
    super(code);
    this.name = 'DiscountCalculationError';
  }
}

function assertSafeInt(n: number): boolean {
  return Number.isSafeInteger(n);
}

/** round_half_up(value * rateBps / 10000) using exact integer arithmetic (non-negative inputs only). */
export function applyRateHalfUp(amountMinor: number, rateBps: number): number {
  const numerator = BigInt(amountMinor) * BigInt(rateBps);
  const denom = BigInt(BPS_DENOMINATOR);
  const q = numerator / denom;
  const r = numerator % denom;
  return Number(r * 2n >= denom ? q + 1n : q);
}

export function isValidRateBps(rateBps: number): boolean {
  return assertSafeInt(rateBps) && rateBps > 0 && rateBps <= MAX_RATE_BPS;
}

export function calculateDiscount(input: DiscountInput): DiscountResult {
  const { grossMinor, eligibleMinor, rateBps, maxInvoiceMinor } = input;
  if (!assertSafeInt(grossMinor) || !assertSafeInt(eligibleMinor) || grossMinor <= 0 || eligibleMinor <= 0) {
    throw new DiscountCalculationError('INVALID_AMOUNT');
  }
  if (grossMinor > maxInvoiceMinor) throw new DiscountCalculationError('AMOUNT_TOO_LARGE');
  if (eligibleMinor > grossMinor) throw new DiscountCalculationError('ELIGIBLE_EXCEEDS_GROSS');
  if (!isValidRateBps(rateBps)) throw new DiscountCalculationError('INVALID_RATE');
  if (input.minEligibleMinor != null && eligibleMinor < input.minEligibleMinor) {
    throw new DiscountCalculationError('BELOW_MINIMUM');
  }
  let discountMinor = applyRateHalfUp(eligibleMinor, rateBps);
  let capped = false;
  if (input.maxDiscountMinor != null && discountMinor > input.maxDiscountMinor) {
    discountMinor = input.maxDiscountMinor;
    capped = true;
  }
  const netMinor = grossMinor - discountMinor;
  if (netMinor < 0) throw new DiscountCalculationError('INVALID_AMOUNT');
  return { grossMinor, eligibleMinor, rateBps, discountMinor, netMinor, capped };
}

/** Parse a user-typed major amount such as "200", "200.5", "200.50", "٢٠٠٫٥٠" into minor units. Returns null if invalid. */
export function parseMajorToMinor(input: string): number | null {
  const normalized = normalizeDigits(input).trim().replace(/[٫,]/g, '.');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, frac = ''] = normalized.split('.');
  const minor = Number(whole) * MINOR_PER_MAJOR + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Convert Arabic-Indic and Eastern Arabic-Indic digits to ASCII digits. */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Format minor units as a plain decimal string, e.g. 16000 -> "160.00". */
export function minorToDecimalString(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / MINOR_PER_MAJOR);
  const frac = String(abs % MINOR_PER_MAJOR).padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}

/** Display format with the shekel sign. Uses Latin digits for consistency in mixed RTL text. */
export function formatILS(minor: number, locale: 'ar' | 'en' = 'ar'): string {
  const value = minorToDecimalString(minor);
  // U+2066/U+2069 isolate the number so it renders correctly inside RTL sentences.
  return locale === 'ar' ? `⁦${value}⁩ ₪` : `₪${value}`;
}

export function formatRateBps(rateBps: number): string {
  const whole = Math.floor(rateBps / 100);
  const frac = rateBps % 100;
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}%`;
}
