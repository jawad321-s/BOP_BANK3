import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { businessDate, encodeQrPayload, nextBusinessDayStart, type CardResponse, type HomeResponse, type MeResponse, type Paginated, type QrTokenResponse, type RedemptionView, type Workspaces, type AdminPermission } from '@bitaqati/shared';
import { AuditService } from '../common/audit.service';
import { Clock } from '../common/clock';
import { randomToken, sha256 } from '../common/crypto';
import { AppError } from '../common/errors';
import { sanitizeImage } from '../common/image';
import { logger } from '../common/logger';
import { enqueueOutbox } from '../common/outbox';
import { PrismaService } from '../common/prisma.service';
import { RateLimitService } from '../common/rate-limit.service';
import { SettingsService } from '../common/settings.service';
import { StorageService } from '../common/storage.service';
import { MembershipService } from '../domain/membership.service';
import { redemptionView } from '../domain/views';
import { AuthService } from './auth.service';
import { StoresService } from './stores.service';

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly membership: MembershipService,
    private readonly stores: StoresService,
    private readonly storage: StorageService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  async workspaces(userId: string): Promise<Workspaces> {
    const [memberships, grants] = await Promise.all([
      this.prisma.merchantMembership.findMany({
        where: { userId, active: true, merchant: { status: 'ACTIVE' } },
        include: { merchant: true, branches: true },
      }),
      this.prisma.adminPermissionGrant.findMany({ where: { userId } }),
    ]);
    const merchant: Workspaces['merchant'] = [];
    for (const m of memberships) {
      const allowed = new Set(m.branches.map((b) => b.branchId));
      const stores = await this.prisma.store.findMany({
        where: { merchantId: m.merchantId, status: { not: 'PENDING' } },
        include: { branches: { where: { status: 'ACTIVE' }, orderBy: { nameEn: 'asc' } } },
        orderBy: { nameEn: 'asc' },
      });
      merchant.push({
        membershipId: m.id,
        merchantId: m.merchantId,
        merchantName: { ar: m.merchant.nameAr, en: m.merchant.nameEn },
        role: m.role,
        stores: stores
          .map((s) => ({
            id: s.id,
            name: { ar: s.nameAr, en: s.nameEn },
            branches: s.branches.filter((b) => m.role === 'OWNER' || allowed.has(b.id)).map((b) => ({ id: b.id, name: { ar: b.nameAr, en: b.nameEn } })),
          }))
          .filter((s) => s.branches.length > 0),
      });
    }
    return { user: true, merchant, admin: grants.length ? { permissions: grants.map((g) => g.permission as AdminPermission) } : null };
  }

  async me(userId: string): Promise<MeResponse> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } });
    return {
      id: u.id,
      email: u.email,
      emailVerified: !!u.emailVerifiedAt,
      fullName: u.profile?.fullName ?? '',
      locale: u.locale === 'en' ? 'en' : 'ar',
      photoStatus: u.profile?.photoStatus ?? 'NONE',
      photoRejectReason: u.profile?.photoRejectReason ?? null,
      workspaces: await this.workspaces(userId),
    };
  }

  async updateProfile(userId: string, patch: { fullName?: string; locale?: 'ar' | 'en' }): Promise<MeResponse> {
    await this.prisma.$transaction(async (tx) => {
      if (patch.locale) await tx.user.update({ where: { id: userId }, data: { locale: patch.locale } });
      if (patch.fullName) {
        const before = await tx.userProfile.findUniqueOrThrow({ where: { userId } });
        if (before.fullName !== patch.fullName) {
          await tx.userProfile.update({ where: { userId }, data: { fullName: patch.fullName } });
          await this.audit.log({ actorUserId: userId, action: 'user.name_changed', entityType: 'user', entityId: userId, before: { fullName: before.fullName }, after: { fullName: patch.fullName } }, tx);
        }
      }
    });
    return this.me(userId);
  }

  async home(userId: string): Promise<HomeResponse> {
    const now = this.clock.now();
    const { timezone } = await this.settings.get();
    const today = businessDate(now, timezone);
    const summary = await this.membership.summary(userId, now);
    const [agg, distinct, todayRows, profile] = await Promise.all([
      this.prisma.redemption.aggregate({ where: { userId, status: 'CONFIRMED' }, _count: { _all: true }, _sum: { discountMinor: true } }),
      this.prisma.redemption.findMany({ where: { userId, status: 'CONFIRMED' }, distinct: ['storeId'], select: { storeId: true } }),
      this.prisma.redemption.findMany({ where: { userId, status: 'CONFIRMED', businessDate: new Date(today) }, orderBy: { confirmedAt: 'desc' } }),
      this.prisma.userProfile.findUnique({ where: { userId } }),
    ]);
    const viewer = { signedIn: true, membership: summary.state, usedStoreIds: new Set(todayRows.map((r) => r.storeId)) };
    const include = { category: true, branches: { where: { status: 'ACTIVE' as const } }, offers: { where: { status: 'ACTIVE' as const } } };
    const [availableStores, usedStores] = await Promise.all([
      this.prisma.store.findMany({
        where: { status: 'ACTIVE', merchant: { status: 'ACTIVE' }, offers: { some: { status: 'ACTIVE' } }, id: { notIn: [...viewer.usedStoreIds] } },
        include,
        orderBy: { nameEn: 'asc' },
        take: 20,
      }),
      this.prisma.store.findMany({ where: { id: { in: [...viewer.usedStoreIds] } }, include }),
    ]);
    const usedById = new Map(usedStores.map((s) => [s.id, s]));
    return {
      fullName: profile?.fullName ?? '',
      membership: { state: summary.state, cardStatus: summary.cardStatus, subscriptionEndsAt: summary.subscriptionEndsAt, daysRemaining: summary.daysRemaining, planName: summary.planName },
      stats: {
        distinctStoresUsed: distinct.length,
        totalRedemptions: agg._count._all,
        todayRedemptions: todayRows.length,
        totalSavingsMinor: agg._sum.discountMinor ?? 0,
      },
      businessDate: today,
      timezone,
      nextResetAt: nextBusinessDayStart(now, timezone).toISOString(),
      serverTime: now.toISOString(),
      availableToday: summary.state === 'ACTIVE' ? availableStores.map((s) => this.stores.summary(s, viewer, now, timezone)) : [],
      usedToday: todayRows
        .filter((r) => usedById.has(r.storeId))
        .map((r) => ({ ...this.stores.summary(usedById.get(r.storeId)!, viewer, now, timezone), redeemedAt: r.confirmedAt.toISOString(), redemptionRef: r.ref })),
    };
  }

  async card(userId: string): Promise<CardResponse> {
    const now = this.clock.now();
    const s = await this.membership.summary(userId, now);
    const { loaded } = s;
    return {
      membership: { state: s.state, cardStatus: s.cardStatus, subscriptionEndsAt: s.subscriptionEndsAt, daysRemaining: s.daysRemaining, planName: s.planName },
      card: loaded.card ? { id: loaded.card.id, serialNumber: loaded.card.serialNumber, status: loaded.card.status, issuedAt: loaded.card.issuedAt.toISOString() } : null,
      holderName: loaded.profile?.fullName ?? '',
      photoStatus: loaded.profile?.photoStatus ?? 'NONE',
      hasApprovedPhoto: !!loaded.profile?.photoKey,
      canShowQr: s.state === 'ACTIVE',
    };
  }

  /** Issues a short-lived QR token bound to the card and the requesting session. Older live tokens are revoked. */
  async issueQr(userId: string, sessionId: string): Promise<QrTokenResponse> {
    await this.rateLimit.hit(`qr:${userId}`, 30, 300);
    const now = this.clock.now();
    const m = await this.membership.load(userId, now);
    if (m.state !== 'ACTIVE' || !m.card) {
      const map = { EXPIRED: 'CARD_EXPIRED', SUSPENDED: 'CARD_SUSPENDED', REVOKED: 'CARD_REVOKED', PENDING_ACTIVATION: 'CARD_PENDING', PHOTO_PENDING: 'PHOTO_NOT_APPROVED', NO_CARD: 'CARD_NOT_FOUND' } as const;
      throw new AppError(map[m.state as keyof typeof map] ?? 'CARD_NOT_FOUND');
    }
    const { qrTtlSeconds } = await this.settings.get();
    const token = randomToken(32);
    const expiresAt = new Date(now.getTime() + qrTtlSeconds * 1000);
    await this.prisma.$transaction([
      this.prisma.qrToken.updateMany({ where: { cardId: m.card.id, usedAt: null, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.qrToken.create({ data: { cardId: m.card.id, sessionId, tokenHash: sha256(token), expiresAt } }),
    ]);
    return { payload: encodeQrPayload(token), expiresAt: expiresAt.toISOString(), ttlSeconds: qrTtlSeconds, serverTime: now.toISOString() };
  }

  async usage(userId: string, q: { cursor?: string; limit: number; from?: string; to?: string; status?: 'CONFIRMED' | 'VOIDED' }): Promise<Paginated<RedemptionView>> {
    const where: Prisma.RedemptionWhereInput = {
      userId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to ? { businessDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    return paginateRedemptions(this.prisma, where, q.cursor, q.limit, (r) => redemptionView(r));
  }

  async sessions(userId: string, currentSessionId: string) {
    const rows = await this.prisma.session.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: this.clock.now() } }, orderBy: { lastUsedAt: 'desc' } });
    return rows.map((s) => ({ id: s.id, deviceName: s.deviceName, platform: s.platform, createdAt: s.createdAt.toISOString(), lastUsedAt: s.lastUsedAt.toISOString(), current: s.id === currentSessionId }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const s = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!s || s.userId !== userId) throw new AppError('NOT_FOUND');
    await this.auth.revokeSession(sessionId, 'user_revoked');
  }

  // ---------------------------------------------------------------- photo

  /**
   * New uploads go to `pendingPhotoKey`. Merchants keep seeing the previously approved photo (if any) until an
   * admin approves the new one — the card holder can never be swapped silently.
   */
  async uploadPhoto(userId: string, file: Buffer | undefined): Promise<{ photoStatus: 'PENDING' }> {
    await this.rateLimit.hit(`photo:${userId}`, 10, 3600);
    const clean = await sanitizeImage(file);
    const key = `profiles/${userId}/${randomToken(12)}.jpg`;
    await this.storage.put(key, clean, 'image/jpeg');
    const previous = await this.prisma.userProfile.findUniqueOrThrow({ where: { userId } });
    await this.prisma.$transaction(async (tx) => {
      await tx.userProfile.update({ where: { userId }, data: { pendingPhotoKey: key, photoStatus: 'PENDING', photoRejectReason: null } });
      await this.audit.log({ actorUserId: userId, action: 'user.photo_submitted', entityType: 'user', entityId: userId }, tx);
    });
    if (previous.pendingPhotoKey && previous.pendingPhotoKey !== previous.photoKey) {
      await this.storage.delete(previous.pendingPhotoKey).catch((e) => logger.warn({ err: (e as Error).message }, 'failed to delete superseded photo'));
    }
    return { photoStatus: 'PENDING' };
  }

  async photo(userId: string, which: 'approved' | 'pending'): Promise<Buffer> {
    const p = await this.prisma.userProfile.findUnique({ where: { userId } });
    const key = which === 'pending' ? p?.pendingPhotoKey : p?.photoKey;
    if (!key) throw new AppError('NOT_FOUND');
    const buf = await this.storage.get(key);
    if (!buf) throw new AppError('NOT_FOUND');
    return buf;
  }

  // ---------------------------------------------------------------- notifications

  async notifications(userId: string, cursor: string | undefined, limit: number, locale: 'ar' | 'en') {
    const rows = await this.prisma.notification.findMany({
      where: { userId, ...(cursor ? { createdAt: { lt: new Date(Buffer.from(cursor, 'base64url').toString()) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((n) => ({
      id: n.id,
      type: n.type,
      title: locale === 'en' ? n.titleEn : n.titleAr,
      body: locale === 'en' ? n.bodyEn : n.bodyAr,
      data: n.data,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    }));
    const unread = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { items, unread, nextCursor: hasMore ? Buffer.from(items[items.length - 1].createdAt).toString('base64url') : null };
  }

  async markRead(userId: string, ids: string[] | 'all'): Promise<void> {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null, ...(ids === 'all' ? {} : { id: { in: ids } }) }, data: { readAt: this.clock.now() } });
  }

  async prefs(userId: string) {
    const p = await this.prisma.notificationPreference.upsert({ where: { userId }, create: { userId }, update: {} });
    return { marketing: p.marketing, dailySummary: p.dailySummary, expiryReminders: p.expiryReminders };
  }

  async updatePrefs(userId: string, patch: { marketing?: boolean; dailySummary?: boolean; expiryReminders?: boolean }) {
    await this.prisma.notificationPreference.upsert({ where: { userId }, create: { userId, ...patch }, update: patch });
    return this.prefs(userId);
  }

  async registerPushToken(userId: string, sessionId: string, token: string, platform: string): Promise<void> {
    const now = this.clock.now();
    // A device token belongs to exactly one account/session: re-registering moves it (e.g. after account switch).
    await this.prisma.devicePushToken.upsert({
      where: { token },
      create: { token, platform, userId, sessionId },
      update: { userId, sessionId, platform, lastSeenAt: now, disabledAt: null },
    });
  }

  async removePushToken(userId: string, token: string): Promise<void> {
    await this.prisma.devicePushToken.updateMany({ where: { token, userId }, data: { disabledAt: this.clock.now() } });
  }

  // ---------------------------------------------------------------- account deletion

  /**
   * In-app account deletion (App Store guideline 5.1.1(v)). Requires the password (re-authentication).
   * Effects are immediate: sessions, tokens, push tokens, QR tokens, card, photos, notifications and profile PII
   * are removed. Confirmed redemptions are retained without personal data (merchant/accounting records);
   * the user row becomes a tombstone with the email replaced. See docs/security.md#deletion.
   */
  async deleteAccount(userId: string, password: string): Promise<{ status: 'DELETED'; retained: string[] }> {
    await this.rateLimit.hit(`reauth:${userId}`, 10, 900);
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true, adminPermissions: true } });
    if (!(await this.auth.verifyPassword(u.passwordHash, password))) throw new AppError('REAUTH_REQUIRED');
    const now = this.clock.now();
    const keys = [u.profile?.photoKey, u.profile?.pendingPhotoKey].filter((k): k is string => !!k);
    await this.prisma.$transaction(async (tx) => {
      await this.auth.revokeAllSessions(userId, 'account_deleted', undefined, tx);
      await tx.refreshToken.deleteMany({ where: { session: { userId } } });
      await tx.devicePushToken.deleteMany({ where: { userId } });
      await tx.qrToken.deleteMany({ where: { card: { userId } } });
      await tx.emailToken.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.notificationPreference.deleteMany({ where: { userId } });
      await tx.adminPermissionGrant.deleteMany({ where: { userId } });
      await tx.merchantMembership.updateMany({ where: { userId }, data: { active: false } });
      await tx.card.updateMany({ where: { userId, isCurrent: true }, data: { status: 'REVOKED', statusReason: 'account_deleted' } });
      await tx.subscription.updateMany({ where: { userId, status: 'ACTIVE' }, data: { status: 'CANCELLED', cancelledAt: now, cancelReason: 'account_deleted' } });
      await tx.verificationSession.updateMany({ where: { userId, status: { in: ['AWAITING_USER', 'PENDING_MATCH', 'MATCHED'] } }, data: { status: 'CANCELLED' } });
      await tx.discountQuote.updateMany({ where: { userId, status: { in: ['AWAITING_APPROVAL', 'APPROVED'] } }, data: { status: 'SUPERSEDED' } });
      await tx.userProfile.update({
        where: { userId },
        data: { fullName: 'Deleted user', phone: null, city: null, photoKey: null, pendingPhotoKey: null, photoStatus: 'NONE', photoRejectReason: null },
      });
      await tx.user.update({
        where: { id: userId },
        data: { status: 'DELETED', deletedAt: now, email: `deleted+${userId}@deleted.invalid`, passwordHash: '!', mfaSecretEnc: null, mfaRecoveryHashes: [] },
      });
      await tx.accountDeletionRequest.create({ data: { userId, status: 'COMPLETED', completedAt: now, details: { photosDeleted: keys.length } } });
      await this.audit.log({ actorUserId: userId, action: 'user.deleted', entityType: 'user', entityId: userId }, tx);
      await enqueueOutbox(tx, 'account.deleted', { userId, storageKeys: keys }, `account.deleted:${userId}`);
    });
    // Best-effort immediate storage deletion; the outbox retries any failure.
    for (const k of keys) await this.storage.delete(k).catch(() => undefined);
    return { status: 'DELETED', retained: ['redemption_records_without_personal_data', 'audit_log'] };
  }
}

export async function paginateRedemptions<T>(
  prisma: PrismaService,
  where: Prisma.RedemptionWhereInput,
  cursor: string | undefined,
  limit: number,
  map: (r: Awaited<ReturnType<PrismaService['redemption']['findFirstOrThrow']>> & Record<string, unknown>) => T,
  include?: Prisma.RedemptionInclude,
): Promise<Paginated<T>> {
  let cursorWhere: Prisma.RedemptionWhereInput = {};
  if (cursor) {
    const [ts, id] = Buffer.from(cursor, 'base64url').toString().split('|');
    const d = new Date(ts);
    if (!isNaN(d.getTime()) && id) cursorWhere = { OR: [{ confirmedAt: { lt: d } }, { confirmedAt: d, id: { lt: id } }] };
  }
  const rows = await prisma.redemption.findMany({ where: { AND: [where, cursorWhere] }, orderBy: [{ confirmedAt: 'desc' }, { id: 'desc' }], take: limit + 1, include });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page.map((r) => map(r as never)), nextCursor: hasMore && last ? Buffer.from(`${last.confirmedAt.toISOString()}|${last.id}`).toString('base64url') : null };
}
