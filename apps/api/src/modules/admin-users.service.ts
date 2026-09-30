import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { addDays, businessDate, startOfBusinessDay } from '@bitaqati/shared';
import { AuditService } from '../common/audit.service';
import { Clock } from '../common/clock';
import { AppError } from '../common/errors';
import { enqueueOutbox } from '../common/outbox';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { StorageService } from '../common/storage.service';
import { MembershipService } from '../domain/membership.service';
import { redemptionView } from '../domain/views';
import { AuthService } from './auth.service';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly membership: MembershipService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly auth: AuthService,
  ) {}

  async list(q: { cursor?: string; limit: number; q?: string; photoStatus?: string; membership?: string; status?: string }) {
    const now = this.clock.now();
    const where: Prisma.UserWhereInput = {
      ...(q.status ? { status: q.status as never } : { status: { not: 'DELETED' } }),
      ...(q.photoStatus ? { profile: { photoStatus: q.photoStatus as never } } : {}),
      ...(q.q
        ? { OR: [{ email: { contains: q.q, mode: 'insensitive' } }, { profile: { fullName: { contains: q.q, mode: 'insensitive' } } }, { cards: { some: { serialNumber: { contains: q.q.toUpperCase() } } } }] }
        : {}),
      ...(q.membership === 'ACTIVE' ? { subscriptions: { some: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } } } } : {}),
      ...(q.membership === 'EXPIRED' ? { subscriptions: { some: {}, none: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } } } } : {}),
      ...(q.membership === 'NONE' ? { subscriptions: { none: {} } } : {}),
    };
    const offset = q.cursor ? parseInt(Buffer.from(q.cursor, 'base64url').toString(), 10) || 0 : 0;
    const rows = await this.prisma.user.findMany({
      where,
      include: { profile: true, cards: { where: { isCurrent: true } }, subscriptions: { where: { status: 'ACTIVE', endsAt: { gt: now } }, orderBy: { endsAt: 'desc' }, take: 1 } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: q.limit + 1,
    });
    const hasMore = rows.length > q.limit;
    return {
      items: rows.slice(0, q.limit).map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.profile?.fullName ?? '',
        status: u.status,
        photoStatus: u.profile?.photoStatus ?? 'NONE',
        card: u.cards[0] ? { serialNumber: u.cards[0].serialNumber, status: u.cards[0].status } : null,
        subscriptionEndsAt: u.subscriptions[0]?.endsAt.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? Buffer.from(String(offset + q.limit)).toString('base64url') : null,
    };
  }

  async detail(userId: string) {
    const now = this.clock.now();
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        cards: { orderBy: { issuedAt: 'desc' } },
        subscriptions: { include: { plan: true }, orderBy: { startsAt: 'desc' } },
        memberships: { include: { merchant: true } },
        adminPermissions: true,
      },
    });
    if (!u) throw new AppError('NOT_FOUND');
    const [m, recent, audit, sessions] = await Promise.all([
      this.membership.load(userId, now),
      this.prisma.redemption.findMany({ where: { userId }, orderBy: { confirmedAt: 'desc' }, take: 20 }),
      this.prisma.auditLog.findMany({ where: { entityId: userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.session.count({ where: { userId, revokedAt: null, expiresAt: { gt: now } } }),
    ]);
    return {
      id: u.id,
      email: u.email,
      emailVerified: !!u.emailVerifiedAt,
      status: u.status,
      statusReason: u.statusReason,
      createdAt: u.createdAt.toISOString(),
      locale: u.locale,
      fullName: u.profile?.fullName ?? '',
      photo: {
        status: u.profile?.photoStatus ?? 'NONE',
        hasApproved: !!u.profile?.photoKey,
        hasPending: !!u.profile?.pendingPhotoKey,
        rejectReason: u.profile?.photoRejectReason ?? null,
        reviewedAt: u.profile?.photoReviewedAt?.toISOString() ?? null,
      },
      membershipState: m.state,
      cards: u.cards.map((c) => ({ id: c.id, serialNumber: c.serialNumber, status: c.status, isCurrent: c.isCurrent, issuedAt: c.issuedAt.toISOString(), statusReason: c.statusReason })),
      subscriptions: u.subscriptions.map((s) => ({
        id: s.id,
        plan: { id: s.planId, code: s.plan.code, name: { ar: s.plan.nameAr, en: s.plan.nameEn } },
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        status: s.status,
        source: s.source,
        reason: s.reason,
        paymentReference: s.paymentReference,
        cancelReason: s.cancelReason,
      })),
      memberships: u.memberships.map((x) => ({ merchantId: x.merchantId, merchantName: x.merchant.nameEn, role: x.role, active: x.active })),
      adminPermissions: u.adminPermissions.map((p) => p.permission),
      activeSessions: sessions,
      recentRedemptions: recent.map((r) => redemptionView(r)),
      audit: audit.map((a) => ({ id: a.id, action: a.action, actorUserId: a.actorUserId, reason: a.reason, before: a.before, after: a.after, createdAt: a.createdAt.toISOString() })),
    };
  }

  async photo(userId: string, which: 'approved' | 'pending'): Promise<Buffer> {
    const p = await this.prisma.userProfile.findUnique({ where: { userId } });
    const key = which === 'pending' ? p?.pendingPhotoKey : p?.photoKey;
    if (!key) throw new AppError('NOT_FOUND');
    const buf = await this.storage.get(key);
    if (!buf) throw new AppError('NOT_FOUND');
    return buf;
  }

  async reviewPhoto(adminId: string, userId: string, decision: { decision: 'APPROVE' } | { decision: 'REJECT'; reason: string }, requestId?: string) {
    const now = this.clock.now();
    const p = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (!p?.pendingPhotoKey) throw new AppError('NOT_FOUND');
    const oldKey = p.photoKey;
    await this.prisma.$transaction(async (tx) => {
      if (decision.decision === 'APPROVE') {
        await tx.userProfile.update({ where: { userId }, data: { photoKey: p.pendingPhotoKey, pendingPhotoKey: null, photoStatus: 'APPROVED', photoRejectReason: null, photoReviewedAt: now, photoReviewedById: adminId } });
        // Live QR tokens were issued against the previous identity photo.
        await tx.qrToken.updateMany({ where: { card: { userId }, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
      } else {
        await tx.userProfile.update({ where: { userId }, data: { pendingPhotoKey: null, photoStatus: p.photoKey ? 'APPROVED' : 'REJECTED', photoRejectReason: decision.reason, photoReviewedAt: now, photoReviewedById: adminId } });
      }
      await this.audit.log({ actorUserId: adminId, action: decision.decision === 'APPROVE' ? 'user.photo_approved' : 'user.photo_rejected', entityType: 'user', entityId: userId, reason: decision.decision === 'REJECT' ? decision.reason : null, requestId }, tx);
      await enqueueOutbox(tx, 'photo.reviewed', { userId, approved: decision.decision === 'APPROVE', reason: decision.decision === 'REJECT' ? decision.reason : null }, `photo.reviewed:${userId}:${now.getTime()}`);
    });
    if (decision.decision === 'APPROVE' && oldKey) await this.storage.delete(oldKey).catch(() => undefined);
    if (decision.decision === 'REJECT') await this.storage.delete(p.pendingPhotoKey).catch(() => undefined);
  }

  async setUserStatus(adminId: string, userId: string, status: 'ACTIVE' | 'SUSPENDED', reason: string, requestId?: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || u.status === 'DELETED') throw new AppError('NOT_FOUND');
    if (adminId === userId) throw new AppError('FORBIDDEN');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status, statusReason: reason } });
      if (status === 'SUSPENDED') await this.auth.revokeAllSessions(userId, 'account_suspended', undefined, tx);
      await this.audit.log({ actorUserId: adminId, action: status === 'SUSPENDED' ? 'user.suspended' : 'user.reactivated', entityType: 'user', entityId: userId, reason, before: { status: u.status }, after: { status }, requestId }, tx);
    });
  }

  /**
   * Card lifecycle. Every action is audited with a reason. REPLACE issues a new serial; the daily limit is
   * keyed on the user, so replacement never restores a use already consumed today.
   */
  async cardAction(adminId: string, userId: string, action: 'ISSUE' | 'ACTIVATE' | 'SUSPEND' | 'REACTIVATE' | 'REPLACE' | 'REVOKE', reason: string, requestId?: string) {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const u = await tx.user.findUnique({ where: { id: userId } });
      if (!u || u.status === 'DELETED') throw new AppError('NOT_FOUND');
      const current = await tx.card.findFirst({ where: { userId, isCurrent: true } });
      if (current) await tx.$queryRaw`SELECT id FROM cards WHERE id = ${current.id}::uuid FOR UPDATE`;
      const revokeQr = (cardId: string) => tx.qrToken.updateMany({ where: { cardId, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
      let result: { id: string; serialNumber: string; status: string };
      switch (action) {
        case 'ISSUE': {
          if (current && current.status !== 'REVOKED') throw new AppError('CONFLICT');
          if (current) await tx.card.update({ where: { id: current.id }, data: { isCurrent: false } });
          const c = await this.auth.issueCard(tx, userId, 'PENDING');
          result = { ...c, status: 'PENDING' };
          break;
        }
        case 'ACTIVATE':
        case 'REACTIVATE': {
          if (!current || current.status === 'REVOKED') throw new AppError('CARD_NOT_FOUND');
          if (action === 'ACTIVATE' && current.status !== 'PENDING') throw new AppError('CONFLICT');
          if (action === 'REACTIVATE' && current.status !== 'SUSPENDED' && current.status !== 'EXPIRED') throw new AppError('CONFLICT');
          const c = await tx.card.update({ where: { id: current.id }, data: { status: 'ACTIVE', statusReason: reason } });
          result = c;
          break;
        }
        case 'SUSPEND': {
          if (!current || current.status === 'REVOKED') throw new AppError('CARD_NOT_FOUND');
          const c = await tx.card.update({ where: { id: current.id }, data: { status: 'SUSPENDED', statusReason: reason } });
          await revokeQr(current.id);
          await tx.verificationSession.updateMany({ where: { cardId: current.id, status: { in: ['AWAITING_USER', 'PENDING_MATCH', 'MATCHED'] } }, data: { status: 'CANCELLED' } });
          result = c;
          break;
        }
        case 'REVOKE': {
          if (!current) throw new AppError('CARD_NOT_FOUND');
          const c = await tx.card.update({ where: { id: current.id }, data: { status: 'REVOKED', statusReason: reason } });
          await revokeQr(current.id);
          await tx.verificationSession.updateMany({ where: { cardId: current.id, status: { in: ['AWAITING_USER', 'PENDING_MATCH', 'MATCHED'] } }, data: { status: 'CANCELLED' } });
          result = c;
          break;
        }
        case 'REPLACE': {
          if (!current) throw new AppError('CARD_NOT_FOUND');
          await tx.card.update({ where: { id: current.id }, data: { isCurrent: false, status: 'REVOKED', statusReason: `replaced: ${reason}` } });
          await revokeQr(current.id);
          await tx.verificationSession.updateMany({ where: { cardId: current.id, status: { in: ['AWAITING_USER', 'PENDING_MATCH', 'MATCHED'] } }, data: { status: 'CANCELLED' } });
          const next = await this.auth.issueCard(tx, userId, current.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING');
          await tx.card.update({ where: { id: current.id }, data: { replacedById: next.id } });
          result = { ...next, status: current.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING' };
          break;
        }
      }
      await this.audit.log({ actorUserId: adminId, action: `card.${action.toLowerCase()}`, entityType: 'user', entityId: userId, reason, before: current ? { cardId: current.id, serial: current.serialNumber, status: current.status } : null, after: result, requestId }, tx);
      return result;
    });
  }

  /**
   * Manual subscription grant/renewal by an admin (v1). Time is never granted from a client-side payment claim.
   * Renewals stack: a new period starts when the latest active period ends. Periods end at local midnight.
   */
  async grantSubscription(adminId: string, userId: string, input: { planId: string; startsAt?: string; reason: string; paymentReference?: string }, requestId?: string) {
    const now = this.clock.now();
    const { timezone } = await this.settings.get();
    const plan = await this.prisma.plan.findUnique({ where: { id: input.planId } });
    if (!plan || !plan.active) throw new AppError('NOT_FOUND');
    return this.prisma.$transaction(async (tx) => {
      const u = await tx.user.findUnique({ where: { id: userId } });
      if (!u || u.status === 'DELETED') throw new AppError('NOT_FOUND');
      const latest = await tx.subscription.findFirst({ where: { userId, status: 'ACTIVE', endsAt: { gt: now } }, orderBy: { endsAt: 'desc' } });
      let startsAt = input.startsAt ? new Date(input.startsAt) : now;
      if (latest && latest.endsAt > startsAt) startsAt = latest.endsAt;
      const startDay = businessDate(startsAt, timezone);
      const endsAt = startOfBusinessDay(addDays(startDay, plan.durationDays), timezone);
      const sub = await tx.subscription.create({
        data: { userId, planId: plan.id, startsAt, endsAt, reason: input.reason, paymentReference: input.paymentReference, createdById: adminId, source: 'ADMIN_MANUAL' },
      });
      const card = await tx.card.findFirst({ where: { userId, isCurrent: true } });
      if (card?.status === 'PENDING') {
        await tx.card.update({ where: { id: card.id }, data: { status: 'ACTIVE', statusReason: 'activated_with_subscription' } });
      }
      await this.audit.log({ actorUserId: adminId, action: 'subscription.granted', entityType: 'user', entityId: userId, reason: input.reason, after: { subscriptionId: sub.id, plan: plan.code, startsAt: sub.startsAt, endsAt: sub.endsAt, paymentReference: input.paymentReference ?? null }, requestId }, tx);
      await enqueueOutbox(tx, 'membership.activated', { userId, subscriptionId: sub.id }, `membership.activated:${sub.id}`);
      return { id: sub.id, startsAt: sub.startsAt.toISOString(), endsAt: sub.endsAt.toISOString() };
    });
  }

  async cancelSubscription(adminId: string, subscriptionId: string, reason: string, requestId?: string) {
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      const s = await tx.subscription.findUnique({ where: { id: subscriptionId } });
      if (!s) throw new AppError('NOT_FOUND');
      if (s.status !== 'ACTIVE') throw new AppError('CONFLICT');
      await tx.subscription.update({ where: { id: s.id }, data: { status: 'CANCELLED', cancelledAt: now, cancelledById: adminId, cancelReason: reason } });
      await this.audit.log({ actorUserId: adminId, action: 'subscription.cancelled', entityType: 'user', entityId: s.userId, reason, before: { subscriptionId: s.id, status: 'ACTIVE' }, after: { status: 'CANCELLED' }, requestId }, tx);
    });
  }

  async resetMfa(adminId: string, userId: string, reason: string, requestId?: string) {
    if (adminId === userId) throw new AppError('FORBIDDEN');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { mfaEnabledAt: null, mfaSecretEnc: null, mfaRecoveryHashes: [] } });
      await this.auth.revokeAllSessions(userId, 'mfa_reset', undefined, tx);
      await this.audit.log({ actorUserId: adminId, action: 'admin.mfa_reset', entityType: 'user', entityId: userId, reason, requestId }, tx);
    });
  }

  async setAdminPermissions(adminId: string, userId: string, permissions: string[], reason: string, requestId?: string) {
    if (adminId === userId) throw new AppError('FORBIDDEN');
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.adminPermissionGrant.findMany({ where: { userId } });
      await tx.adminPermissionGrant.deleteMany({ where: { userId } });
      if (permissions.length) await tx.adminPermissionGrant.createMany({ data: permissions.map((p) => ({ userId, permission: p, grantedById: adminId })) });
      // Force re-login so new permissions apply to fresh MFA sessions only.
      await this.auth.revokeAllSessions(userId, 'permissions_changed', undefined, tx);
      await this.audit.log({ actorUserId: adminId, action: 'admin.permissions_changed', entityType: 'user', entityId: userId, reason, before: before.map((b) => b.permission), after: permissions, requestId }, tx);
    });
  }
}
