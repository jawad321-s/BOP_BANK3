import type { DiscountQuote, Redemption, Branch, Store } from '@prisma/client';
import type { QuoteView, RedemptionView } from '@bitaqati/shared';

export function redemptionView(r: Redemption, extra?: { customerName?: string; staffName?: string }): RedemptionView {
  return {
    id: r.id,
    ref: r.ref,
    status: r.status,
    store: { id: r.storeId, name: { ar: r.storeNameAr, en: r.storeNameEn } },
    branch: { id: r.branchId, name: { ar: r.branchNameAr, en: r.branchNameEn } },
    businessDate: r.businessDate.toISOString().slice(0, 10),
    timezone: r.timezone,
    confirmedAt: r.confirmedAt.toISOString(),
    grossMinor: r.grossMinor,
    eligibleMinor: r.eligibleMinor,
    rateBps: r.rateBps,
    discountMinor: r.discountMinor,
    netMinor: r.netMinor,
    currency: 'ILS',
    voidedAt: r.voidedAt?.toISOString() ?? null,
    voidReason: r.voidReason,
    ...(extra ?? {}),
  };
}

export function quoteView(q: DiscountQuote & { verification?: { store: Store; branch: Branch } }, store: Store, branch: Branch): QuoteView {
  const terms = (q.termsSnapshot ?? {}) as { termsAr?: string; termsEn?: string };
  return {
    id: q.id,
    status: q.status,
    grossMinor: q.grossMinor,
    eligibleMinor: q.eligibleMinor,
    eligibleReason: q.eligibleReason,
    rateBps: q.rateBps,
    discountMinor: q.discountMinor,
    netMinor: q.netMinor,
    capped: q.capped,
    expiresAt: q.expiresAt.toISOString(),
    fingerprint: q.fingerprint,
    store: { id: store.id, name: { ar: store.nameAr, en: store.nameEn } },
    branch: { id: branch.id, name: { ar: branch.nameAr, en: branch.nameEn } },
    terms: { ar: terms.termsAr ?? '', en: terms.termsEn ?? '' },
  };
}
