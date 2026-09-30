import { Injectable } from '@nestjs/common';
import { Prisma, type DiscountOffer, type VerificationSession } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  businessDate,
  calculateDiscount,
  decodeQrPayload,
  DiscountCalculationError,
  type QuoteView,
  type RedemptionView,
  type VerificationView,
} from '@bitaqati/shared';
import { config } from '../config';
import { AuditService } from '../common/audit.service';
import { Clock } from '../common/clock';
import { normalizeSerial, redemptionRef, sha256 } from '../common/crypto';
import { AppError } from '../common/errors';
import { logger } from '../common/logger';
import { enqueueOutbox } from '../common/outbox';
import { isUniqueViolation, PrismaService, type Tx } from '../common/prisma.service';
import { RateLimitService } from '../common/rate-limit.service';
import { SettingsService } from '../common/settings.service';
import { MembershipService, membershipErrorCode } from './membership.service';
import { MerchantAccessService } from './merchant-access.service';
import { quoteView, redemptionView } from './views';

const OPEN_VERIFICATION: Array<VerificationSession['status']> = ['AWAITING_USER', 'PENDING_MATCH', 'MATCHED'];

function quoteFingerprint(q: {
  id: string;
  verificationId: string;
  userId: string;
  storeId: string;
  branchId: string;
  offerId: string;
  offerVersion: number;
  rateBps: number;
  grossMinor: number;
  eligibleMinor: number;
  discountMinor: number;
  netMinor: number;
  expiresAt: Date;
}): string {
  return sha256(
    [q.id, q.verificationId, q.userId, q.storeId, q.branchId, q.offerId, q.offerVersion, q.rateBps, q.grossMinor, q.eligibleMinor, q.discountMinor, q.netMinor, q.expiresAt.toISOString()].join('|'),
  );
}

/**
 * The discount flow:
 *   scan/lookup → verification session (no consumption)
 *   → staff confirms visual match
 *   → server-computed quote (merchant never supplies rate or final amount)
 *   → customer approves exact quote in-app (fingerprint-bound)
 *   → staff confirms: single transaction re-checks everything and inserts the redemption.
 * The daily limit is enforced by a partial unique index, not by read-then-write.
 */
@Injectable()
export class RedemptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly membership: MembershipService,
    private readonly access: MerchantAccessService,
    private readonly settings: SettingsService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- verification

  async createVerification(staffUserId: string, input: { branchId: string; qrPayload?: string; serialNumber?: string }): Promise<VerificationView> {
    const access = await this.access.requireBranch(staffUserId, input.branchId);
    this.access.assertOperational(access);
    const now = this.clock.now();
    await this.rateLimit.hit(`verify:${staffUserId}`, 60, 600);

    let cardId: string;
    let method: 'QR' | 'MANUAL';
    if (input.qrPayload) {
      method = 'QR';
      const token = decodeQrPayload(input.qrPayload);
      if (!token) throw new AppError('QR_INVALID');
      const hash = sha256(token);
      // Atomic single-use claim of the token.
      const claimed = await this.prisma.$queryRaw<Array<{ card_id: string; session_id: string }>>`
        UPDATE qr_tokens SET used_at = ${now}
        WHERE token_hash = ${hash} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ${now}
        RETURNING card_id, session_id`;
      if (claimed.length === 0) {
        const existing = await this.prisma.qrToken.findUnique({ where: { tokenHash: hash } });
        if (existing && !existing.usedAt && !existing.revokedAt && existing.expiresAt <= now) throw new AppError('QR_EXPIRED');
        throw new AppError('QR_INVALID');
      }
      const session = await this.prisma.session.findUnique({ where: { id: claimed[0].session_id } });
      if (!session || session.revokedAt || session.expiresAt <= now) throw new AppError('QR_INVALID');
      cardId = claimed[0].card_id;
    } else {
      method = 'MANUAL';
      // Manual lookup is rate-limited per staff and per branch to prevent serial enumeration.
      await this.rateLimit.hit(`manual:${staffUserId}`, 10, 600);
      await this.rateLimit.hit(`manual-branch:${input.branchId}`, 40, 3600);
      const serial = normalizeSerial(input.serialNumber ?? '');
      const card = serial ? await this.prisma.card.findUnique({ where: { serialNumber: serial } }) : null;
      if (!card || !card.isCurrent) throw new AppError('CARD_NOT_FOUND');
      cardId = card.id;
    }

    const card = await this.prisma.card.findUniqueOrThrow({ where: { id: cardId } });
    if (!card.isCurrent) throw new AppError('QR_INVALID');

    if (method === 'QR') {
      // QR scan proves the holder's app is present; reject ineligible cards before revealing anything.
      const m = await this.membership.load(card.userId, now);
      const code = membershipErrorCode(m.state);
      if (code) throw new AppError(code);
    }

    const expiresAt = new Date(now.getTime() + config().VERIFICATION_TTL_SECONDS * 1000);
    const v = await this.prisma.$transaction(async (tx) => {
      // Close any other open verification for this card at this branch: one live session per card+branch.
      await tx.verificationSession.updateMany({
        where: { cardId, branchId: access.branch.id, status: { in: OPEN_VERIFICATION } },
        data: { status: 'CANCELLED' },
      });
      const created = await tx.verificationSession.create({
        data: {
          cardId,
          userId: card.userId,
          merchantId: access.merchant.id,
          storeId: access.store.id,
          branchId: access.branch.id,
          staffUserId,
          method,
          status: method === 'QR' ? 'PENDING_MATCH' : 'AWAITING_USER',
          userConfirmedAt: method === 'QR' ? now : null,
          expiresAt,
        },
      });
      if (method === 'MANUAL') {
        await enqueueOutbox(tx, 'verification.requested', { verificationId: created.id, userId: card.userId, storeId: access.store.id }, `verification.requested:${created.id}`);
      }
      return created;
    });
    return this.verificationView(v.id, staffUserId);
  }

  async getVerificationForStaff(staffUserId: string, id: string): Promise<VerificationView> {
    return this.verificationView(id, staffUserId);
  }

  private async loadVerificationForStaff(staffUserId: string, id: string) {
    const v = await this.prisma.verificationSession.findUnique({ where: { id }, include: { store: true, branch: true } });
    if (!v) throw new AppError('NOT_FOUND');
    await this.access.requireBranch(staffUserId, v.branchId); // throws if caller has no access to this branch
    return v;
  }

  async verificationView(id: string, staffUserId: string): Promise<VerificationView> {
    const v = await this.loadVerificationForStaff(staffUserId, id);
    const now = this.clock.now();
    const { timezone } = await this.settings.get();
    const expired = v.expiresAt <= now && OPEN_VERIFICATION.includes(v.status);
    const status = expired ? 'CANCELLED' : v.status;
    const holderVisible = !expired && (v.status === 'PENDING_MATCH' || v.status === 'MATCHED' || v.status === 'COMPLETED');

    const [m, offer, quote, redemption, todayUse] = await Promise.all([
      holderVisible ? this.membership.load(v.userId, now) : Promise.resolve(null),
      this.prisma.discountOffer.findFirst({ where: { storeId: v.storeId, status: 'ACTIVE' } }),
      this.prisma.discountQuote.findFirst({ where: { verificationId: v.id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.redemption.findFirst({ where: { verificationId: v.id } }),
      this.prisma.redemption.findFirst({
        where: { userId: v.userId, storeId: v.storeId, status: 'CONFIRMED', businessDate: new Date(businessDate(now, timezone)) },
        select: { id: true },
      }),
    ]);
    const card = holderVisible ? await this.prisma.card.findUnique({ where: { id: v.cardId } }) : null;
    let q: QuoteView | null = null;
    if (quote) {
      const qStatus = quote.expiresAt <= now && (quote.status === 'AWAITING_APPROVAL' || quote.status === 'APPROVED') ? 'EXPIRED' : quote.status;
      q = { ...quoteView(quote, v.store, v.branch), status: qStatus };
    }
    return {
      id: v.id,
      status,
      method: v.method,
      expiresAt: v.expiresAt.toISOString(),
      store: { id: v.store.id, name: { ar: v.store.nameAr, en: v.store.nameEn } },
      branch: { id: v.branch.id, name: { ar: v.branch.nameAr, en: v.branch.nameEn } },
      holder: holderVisible && m ? { fullName: m.profile?.fullName ?? '', photoAvailable: !!m.profile?.photoKey, serialNumber: card?.serialNumber ?? '' } : null,
      membershipState: m?.state ?? null,
      alreadyRedeemedToday: !!todayUse && todayUse.id !== redemption?.id,
      offer: offer
        ? { rateBps: offer.rateBps, minEligibleMinor: offer.minEligibleMinor, maxDiscountMinor: offer.maxDiscountMinor, terms: { ar: offer.termsAr, en: offer.termsEn } }
        : null,
      currentQuote: q,
      redemption: redemption ? redemptionView(redemption) : null,
    };
  }

  /** Approved photo key for a live verification, only for staff with access to that branch. */
  async verificationPhotoKey(staffUserId: string, id: string): Promise<string> {
    const v = await this.loadVerificationForStaff(staffUserId, id);
    const now = this.clock.now();
    if (v.expiresAt <= now || !(v.status === 'PENDING_MATCH' || v.status === 'MATCHED')) throw new AppError('VERIFICATION_EXPIRED');
    const profile = await this.prisma.userProfile.findUnique({ where: { userId: v.userId } });
    if (!profile?.photoKey) throw new AppError('PHOTO_NOT_APPROVED');
    return profile.photoKey;
  }

  async decideMatch(staffUserId: string, id: string, decision: 'MATCH' | 'MISMATCH'): Promise<VerificationView> {
    const v = await this.loadVerificationForStaff(staffUserId, id);
    const now = this.clock.now();
    if (v.expiresAt <= now) throw new AppError('VERIFICATION_EXPIRED');
    if (v.status === 'AWAITING_USER') throw new AppError('AWAITING_USER_CONFIRMATION');
    if (v.status !== 'PENDING_MATCH') throw new AppError('CONFLICT');
    const updated = await this.prisma.verificationSession.updateMany({
      where: { id, status: 'PENDING_MATCH' },
      data: decision === 'MATCH' ? { status: 'MATCHED', matchedAt: now } : { status: 'MISMATCHED' },
    });
    if (updated.count !== 1) throw new AppError('CONFLICT');
    if (decision === 'MISMATCH') {
      await this.audit.log({ actorUserId: staffUserId, action: 'verification.mismatch', entityType: 'verification', entityId: id, after: { cardId: v.cardId, branchId: v.branchId } });
    }
    return this.verificationView(id, staffUserId);
  }

  async cancelVerification(staffUserId: string, id: string): Promise<void> {
    await this.loadVerificationForStaff(staffUserId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.verificationSession.updateMany({ where: { id, status: { in: OPEN_VERIFICATION } }, data: { status: 'CANCELLED' } });
      await tx.discountQuote.updateMany({ where: { verificationId: id, status: { in: ['AWAITING_APPROVAL', 'APPROVED'] } }, data: { status: 'SUPERSEDED' } });
    });
  }

  // ---------------------------------------------------------------- user side of manual lookup

  async pendingVerificationRequests(userId: string) {
    const now = this.clock.now();
    const rows = await this.prisma.verificationSession.findMany({
      where: { userId, status: 'AWAITING_USER', expiresAt: { gt: now } },
      include: { store: true, branch: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    return rows.map((v) => ({
      id: v.id,
      expiresAt: v.expiresAt.toISOString(),
      store: { id: v.store.id, name: { ar: v.store.nameAr, en: v.store.nameEn } },
      branch: { id: v.branch.id, name: { ar: v.branch.nameAr, en: v.branch.nameEn } },
    }));
  }

  async respondToVerificationRequest(userId: string, id: string, accept: boolean): Promise<{ status: string }> {
    const now = this.clock.now();
    const v = await this.prisma.verificationSession.findUnique({ where: { id } });
    if (!v || v.userId !== userId) throw new AppError('NOT_FOUND');
    if (v.expiresAt <= now) throw new AppError('VERIFICATION_EXPIRED');
    if (accept) {
      const m = await this.membership.load(userId, now);
      const code = membershipErrorCode(m.state);
      if (code) throw new AppError(code);
    }
    const res = await this.prisma.verificationSession.updateMany({
      where: { id, userId, status: 'AWAITING_USER', expiresAt: { gt: now } },
      data: accept ? { status: 'PENDING_MATCH', userConfirmedAt: now } : { status: 'DECLINED' },
    });
    if (res.count !== 1) throw new AppError('CONFLICT');
    return { status: accept ? 'PENDING_MATCH' : 'DECLINED' };
  }

  // ---------------------------------------------------------------- quote

  async createQuote(staffUserId: string, input: { verificationId: string; grossMinor: number; eligibleMinor?: number; eligibleReason?: string }): Promise<QuoteView> {
    const v = await this.loadVerificationForStaff(staffUserId, input.verificationId);
    const now = this.clock.now();
    const access = await this.access.requireBranch(staffUserId, v.branchId);
    this.access.assertOperational(access);
    if (v.expiresAt <= now) throw new AppError('VERIFICATION_EXPIRED');
    if (v.status === 'AWAITING_USER') throw new AppError('AWAITING_USER_CONFIRMATION');
    if (v.status === 'MISMATCHED' || v.status === 'DECLINED') throw new AppError('VERIFICATION_REJECTED');
    if (v.status !== 'MATCHED') throw new AppError('VERIFICATION_NOT_MATCHED');

    const m = await this.membership.load(v.userId, now);
    const code = membershipErrorCode(m.state);
    if (code) throw new AppError(code);

    const settings = await this.settings.get();
    const today = businessDate(now, settings.timezone);
    const used = await this.prisma.redemption.findFirst({ where: { userId: v.userId, storeId: v.storeId, status: 'CONFIRMED', businessDate: new Date(today) }, select: { id: true } });
    if (used) throw new AppError('ALREADY_REDEEMED_TODAY', { businessDate: today });

    const offer = await this.prisma.discountOffer.findFirst({ where: { storeId: v.storeId, status: 'ACTIVE' } });
    if (!offer) throw new AppError('NO_ACTIVE_OFFER');

    const eligibleMinor = input.eligibleMinor ?? input.grossMinor;
    if (eligibleMinor !== input.grossMinor && !input.eligibleReason?.trim()) throw new AppError('ELIGIBLE_REASON_REQUIRED');
    let calc;
    try {
      calc = calculateDiscount({
        grossMinor: input.grossMinor,
        eligibleMinor,
        rateBps: offer.rateBps,
        minEligibleMinor: offer.minEligibleMinor,
        maxDiscountMinor: offer.maxDiscountMinor,
        maxInvoiceMinor: settings.maxInvoiceMinor,
      });
    } catch (e) {
      if (e instanceof DiscountCalculationError) throw new AppError(e.code);
      throw e;
    }

    const id = randomUUID();
    const expiresAt = new Date(Math.min(now.getTime() + config().QUOTE_TTL_SECONDS * 1000, v.expiresAt.getTime()));
    const fingerprint = quoteFingerprint({ id, verificationId: v.id, userId: v.userId, storeId: v.storeId, branchId: v.branchId, offerId: offer.id, offerVersion: offer.version, ...calc, expiresAt });
    const quote = await this.prisma.$transaction(async (tx) => {
      // A new quote invalidates any earlier quote/approval for this verification.
      await tx.discountQuote.updateMany({ where: { verificationId: v.id, status: { in: ['AWAITING_APPROVAL', 'APPROVED'] } }, data: { status: 'SUPERSEDED' } });
      const q = await tx.discountQuote.create({
        data: {
          id,
          verificationId: v.id,
          userId: v.userId,
          storeId: v.storeId,
          branchId: v.branchId,
          staffUserId,
          offerId: offer.id,
          offerVersion: offer.version,
          rateBps: calc.rateBps,
          grossMinor: calc.grossMinor,
          eligibleMinor: calc.eligibleMinor,
          eligibleReason: eligibleMinor !== input.grossMinor ? input.eligibleReason!.trim() : null,
          discountMinor: calc.discountMinor,
          netMinor: calc.netMinor,
          capped: calc.capped,
          termsSnapshot: this.termsSnapshot(offer),
          fingerprint,
          expiresAt,
        },
      });
      await enqueueOutbox(tx, 'quote.created', { quoteId: q.id, userId: v.userId, storeId: v.storeId }, `quote.created:${q.id}`);
      return q;
    });
    return quoteView(quote, v.store, v.branch);
  }

  private termsSnapshot(o: DiscountOffer): Prisma.InputJsonValue {
    return { offerId: o.id, version: o.version, rateBps: o.rateBps, minEligibleMinor: o.minEligibleMinor, maxDiscountMinor: o.maxDiscountMinor, termsAr: o.termsAr, termsEn: o.termsEn };
  }

  // ---------------------------------------------------------------- customer approval

  async pendingApprovals(userId: string): Promise<QuoteView[]> {
    const now = this.clock.now();
    const quotes = await this.prisma.discountQuote.findMany({
      where: { userId, status: 'AWAITING_APPROVAL', expiresAt: { gt: now }, verification: { status: 'MATCHED' } },
      include: { verification: { include: { store: true, branch: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    return quotes.map((q) => quoteView(q, q.verification.store, q.verification.branch));
  }

  async decideApproval(userId: string, sessionId: string, quoteId: string, fingerprint: string, approve: boolean): Promise<QuoteView> {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM discount_quotes WHERE id = ${quoteId}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new AppError('NOT_FOUND');
      const q = await tx.discountQuote.findUniqueOrThrow({ where: { id: quoteId }, include: { verification: { include: { store: true, branch: true } } } });
      if (q.userId !== userId) throw new AppError('NOT_FOUND');
      if (q.status === 'SUPERSEDED') throw new AppError('QUOTE_CHANGED');
      if (q.status === 'CONSUMED') throw new AppError('QUOTE_ALREADY_USED');
      if (q.status !== 'AWAITING_APPROVAL') throw new AppError('CONFLICT');
      if (q.expiresAt <= now) throw new AppError('QUOTE_EXPIRED');
      if (q.fingerprint !== fingerprint) throw new AppError('APPROVAL_MISMATCH');
      const offer = await tx.discountOffer.findUnique({ where: { id: q.offerId } });
      if (!offer || offer.status !== 'ACTIVE') throw new AppError('QUOTE_CHANGED');
      await tx.userApproval.create({ data: { quoteId, userId, sessionId, decision: approve ? 'APPROVED' : 'REJECTED', fingerprint } });
      const updated = await tx.discountQuote.update({ where: { id: quoteId }, data: { status: approve ? 'APPROVED' : 'REJECTED' } });
      return quoteView(updated, q.verification.store, q.verification.branch);
    });
  }

  // ---------------------------------------------------------------- confirmation (the atomic step)

  /**
   * Confirms a redemption exactly once.
   * - Idempotency record (actor, route, key) is inserted in the same transaction as the redemption, so a
   *   replay after commit returns the original response and a replay with different content is rejected.
   * - Row locks on the quote (FOR UPDATE), card (FOR UPDATE), and offer/subscription (FOR SHARE) serialize
   *   with concurrent suspension, renewal cancellation and offer changes.
   * - The partial unique index redemptions_daily_limit_uq is the final arbiter of the daily limit.
   */
  async confirm(staffUserId: string, quoteId: string, idempotencyKey: string | undefined): Promise<{ status: number; body: RedemptionView }> {
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) throw new AppError('IDEMPOTENCY_KEY_REQUIRED');
    const route = 'POST /v1/merchant/redemptions';
    const requestHash = sha256(JSON.stringify({ quoteId }));

    const prior = await this.prisma.idempotencyRecord.findUnique({ where: { actorUserId_route_key: { actorUserId: staffUserId, route, key: idempotencyKey } } });
    if (prior) return this.replay(prior, requestHash);

    // Read settings before opening the transaction: every query inside must use `tx` (no second pool connection).
    const { timezone } = await this.settings.get();
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const now = this.clock.now();

          // Reserve the idempotency key first. A concurrent request with the same key blocks here until we commit/rollback.
          const inserted = await tx.$queryRaw<Array<{ id: string }>>`
            INSERT INTO idempotency_records (id, actor_user_id, route, key, request_hash, response_status, response_body, created_at, expires_at)
            VALUES (${randomUUID()}::uuid, ${staffUserId}::uuid, ${route}, ${idempotencyKey}, ${requestHash}, 0, '{}'::jsonb, ${now}, ${new Date(now.getTime() + 7 * 86400_000)})
            ON CONFLICT (actor_user_id, route, key) DO NOTHING
            RETURNING id`;
          if (inserted.length === 0) throw new ReplaySignal();

          const quoteRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM discount_quotes WHERE id = ${quoteId}::uuid FOR UPDATE`;
          if (quoteRows.length === 0) throw new AppError('NOT_FOUND');
          const quote = await tx.discountQuote.findUniqueOrThrow({ where: { id: quoteId }, include: { approval: true, verification: { include: { store: { include: { merchant: true } }, branch: true } } } });
          const v = quote.verification;

          // Scope: caller must have access to the verification's branch (re-checked inside the transaction).
          const access = await this.access.requireBranch(staffUserId, v.branchId, tx);
          this.access.assertOperational(access);

          if (quote.status === 'CONSUMED') throw new AppError('QUOTE_ALREADY_USED');
          if (quote.status === 'SUPERSEDED') throw new AppError('QUOTE_CHANGED');
          if (quote.status === 'REJECTED') throw new AppError('APPROVAL_REJECTED');
          if (quote.status === 'AWAITING_APPROVAL') throw new AppError('APPROVAL_REQUIRED');
          if (quote.status !== 'APPROVED') throw new AppError('CONFLICT');
          if (quote.expiresAt <= now) throw new AppError('QUOTE_EXPIRED');
          if (v.status !== 'MATCHED' || v.expiresAt <= now) throw new AppError('VERIFICATION_EXPIRED');
          const approval = quote.approval;
          if (!approval || approval.decision !== 'APPROVED' || approval.userId !== quote.userId || approval.fingerprint !== quote.fingerprint || approval.usedAt) {
            throw new AppError('APPROVAL_MISMATCH');
          }

          // Lock the card: suspension/replacement (UPDATE on the card row) serializes with this confirmation.
          await tx.$queryRaw`SELECT id FROM cards WHERE id = ${v.cardId}::uuid FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${quote.userId}::uuid FOR SHARE`;
          await tx.$queryRaw`SELECT id FROM subscriptions WHERE user_id = ${quote.userId}::uuid AND status = 'ACTIVE' FOR SHARE`;
          const offerRows = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM discount_offers WHERE id = ${quote.offerId}::uuid FOR SHARE`;
          if (offerRows[0]?.status !== 'ACTIVE') throw new AppError('QUOTE_CHANGED');

          const m = await this.membership.load(quote.userId, now, tx);
          if (m.card?.id !== v.cardId) throw new AppError('CARD_REVOKED');
          const code = membershipErrorCode(m.state);
          if (code) throw new AppError(code);

          // The business date is the date of confirmation on the server, in the platform zone.
          const bDate = businessDate(now, timezone);
          const existing = await tx.redemption.findFirst({ where: { userId: quote.userId, storeId: quote.storeId, status: 'CONFIRMED', businessDate: new Date(bDate) }, select: { id: true } });
          if (existing) throw new AppError('ALREADY_REDEEMED_TODAY', { businessDate: bDate });

          const redemption = await tx.redemption.create({
            data: {
              ref: redemptionRef(bDate),
              userId: quote.userId,
              cardId: v.cardId,
              merchantId: v.merchantId,
              storeId: quote.storeId,
              branchId: quote.branchId,
              offerId: quote.offerId,
              offerVersion: quote.offerVersion,
              staffUserId,
              quoteId: quote.id,
              verificationId: v.id,
              businessDate: new Date(bDate),
              timezone,
              grossMinor: quote.grossMinor,
              eligibleMinor: quote.eligibleMinor,
              eligibleReason: quote.eligibleReason,
              rateBps: quote.rateBps,
              discountMinor: quote.discountMinor,
              netMinor: quote.netMinor,
              termsSnapshot: quote.termsSnapshot as Prisma.InputJsonValue,
              storeNameAr: v.store.nameAr,
              storeNameEn: v.store.nameEn,
              branchNameAr: v.branch.nameAr,
              branchNameEn: v.branch.nameEn,
              confirmedAt: now,
            },
          });
          await tx.discountQuote.update({ where: { id: quote.id }, data: { status: 'CONSUMED' } });
          await tx.userApproval.update({ where: { id: approval.id }, data: { usedAt: now } });
          await tx.verificationSession.update({ where: { id: v.id }, data: { status: 'COMPLETED' } });
          await tx.redemptionEvent.create({ data: { redemptionId: redemption.id, type: 'CONFIRMED', actorUserId: staffUserId, data: { quoteId: quote.id, approvalId: approval.id } } });
          await enqueueOutbox(tx, 'redemption.confirmed', { redemptionId: redemption.id }, `redemption.confirmed:${redemption.id}`);

          const body = redemptionView(redemption, { customerName: m.profile?.fullName });
          await tx.idempotencyRecord.update({
            where: { actorUserId_route_key: { actorUserId: staffUserId, route, key: idempotencyKey } },
            data: { responseStatus: 201, responseBody: body as never },
          });
          return { status: 201, body };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000, maxWait: 15000 },
      );
    } catch (e) {
      if (e instanceof ReplaySignal) {
        const rec = await this.prisma.idempotencyRecord.findUnique({ where: { actorUserId_route_key: { actorUserId: staffUserId, route, key: idempotencyKey } } });
        if (!rec) throw new AppError('REQUEST_IN_PROGRESS');
        return this.replay(rec, requestHash);
      }
      if (isUniqueViolation(e, 'redemptions_daily_limit_uq')) {
        const { timezone } = await this.settings.get();
        throw new AppError('ALREADY_REDEEMED_TODAY', { businessDate: businessDate(this.clock.now(), timezone) });
      }
      if (isUniqueViolation(e, 'quote_id')) throw new AppError('QUOTE_ALREADY_USED');
      if (isUniqueViolation(e, 'idempotency_records')) throw new AppError('REQUEST_IN_PROGRESS');
      if (!(e instanceof AppError)) logger.error({ err: (e as Error).message, quoteId }, 'redemption confirm failed');
      throw e;
    }
  }

  private replay(rec: { requestHash: string; responseStatus: number; responseBody: unknown }, requestHash: string): { status: number; body: RedemptionView } {
    if (rec.requestHash !== requestHash) throw new AppError('IDEMPOTENCY_KEY_REUSED');
    if (rec.responseStatus === 0) throw new AppError('REQUEST_IN_PROGRESS');
    return { status: rec.responseStatus === 201 ? 200 : rec.responseStatus, body: rec.responseBody as RedemptionView };
  }

  // ---------------------------------------------------------------- void (admin)

  async voidRedemption(adminUserId: string, redemptionId: string, reason: string, requestId?: string): Promise<RedemptionView> {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM redemptions WHERE id = ${redemptionId}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new AppError('NOT_FOUND');
      const r = await tx.redemption.findUniqueOrThrow({ where: { id: redemptionId } });
      if (r.status === 'VOIDED') throw new AppError('ALREADY_VOIDED');
      const updated = await tx.redemption.update({ where: { id: r.id }, data: { status: 'VOIDED', voidedAt: now, voidedById: adminUserId, voidReason: reason } });
      await tx.redemptionEvent.create({ data: { redemptionId: r.id, type: 'VOIDED', actorUserId: adminUserId, reason } });
      await this.audit.log({ actorUserId: adminUserId, action: 'redemption.void', entityType: 'redemption', entityId: r.id, reason, before: { status: 'CONFIRMED' }, after: { status: 'VOIDED' }, requestId }, tx);
      await enqueueOutbox(tx, 'redemption.voided', { redemptionId: r.id }, `redemption.voided:${r.id}`);
      return redemptionView(updated);
    });
  }
}

class ReplaySignal extends Error {}
