import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { addDays, businessDate, type MerchantDashboard, type Paginated, type RedemptionView } from '@bitaqati/shared';
import { AuditService } from '../common/audit.service';
import { Clock } from '../common/clock';
import { randomToken, sha256 } from '../common/crypto';
import { AppError } from '../common/errors';
import { MailService } from '../common/mail.service';
import { PrismaService } from '../common/prisma.service';
import { RateLimitService } from '../common/rate-limit.service';
import { SettingsService } from '../common/settings.service';
import { MerchantAccessService } from '../domain/merchant-access.service';
import { redemptionView } from '../domain/views';
import { config } from '../config';
import { paginateRedemptions } from './me.service';

export function periodRange(period: string, today: string, from?: string, to?: string): { from: string; to: string } {
  switch (period) {
    case 'week':
      return { from: addDays(today, -6), to: today };
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'custom': {
      if (!from || !to || from > to) throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'from/to', message: 'required, from <= to' }] });
      const days = (Date.parse(to) - Date.parse(from)) / 86400_000;
      if (days > 366 * 3) throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'from/to', message: 'range too large' }] });
      return { from, to };
    }
    default:
      return { from: today, to: today };
  }
}

@Injectable()
export class MerchantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly access: MerchantAccessService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Resolves requested store/branch filters against the caller's real scope. */
  private async scope(userId: string, storeId?: string, branchId?: string): Promise<Prisma.RedemptionWhereInput> {
    const acc = await this.access.accessibleBranchIds(userId);
    if (acc.branchIds.length === 0) throw new AppError('FORBIDDEN');
    if (branchId && !acc.branchIds.includes(branchId)) throw new AppError('BRANCH_NOT_ASSIGNED');
    if (storeId && !acc.storeIds.includes(storeId)) throw new AppError('FORBIDDEN');
    return {
      branchId: branchId ? branchId : { in: acc.branchIds },
      ...(storeId ? { storeId } : {}),
    };
  }

  async dashboard(userId: string, q: { storeId?: string; branchId?: string; period: string; from?: string; to?: string }): Promise<MerchantDashboard> {
    const where = await this.scope(userId, q.storeId, q.branchId);
    const { timezone } = await this.settings.get();
    const today = businessDate(this.clock.now(), timezone);
    const range = periodRange(q.period, today, q.from, q.to);
    const periodWhere: Prisma.RedemptionWhereInput = { ...where, status: 'CONFIRMED', businessDate: { gte: new Date(range.from), lte: new Date(range.to) } };
    const todayWhere: Prisma.RedemptionWhereInput = { ...where, status: 'CONFIRMED', businessDate: new Date(today) };
    const [agg, customers, todayCount, todayCustomers] = await Promise.all([
      this.prisma.redemption.aggregate({ where: periodWhere, _count: { _all: true }, _sum: { grossMinor: true, discountMinor: true, netMinor: true } }),
      this.prisma.redemption.findMany({ where: periodWhere, distinct: ['userId'], select: { userId: true } }),
      this.prisma.redemption.count({ where: todayWhere }),
      this.prisma.redemption.findMany({ where: todayWhere, distinct: ['userId'], select: { userId: true } }),
    ]);
    return {
      period: range,
      timezone,
      distinctCustomers: customers.length,
      redemptions: agg._count._all,
      grossMinor: agg._sum.grossMinor ?? 0,
      discountMinor: agg._sum.discountMinor ?? 0,
      netMinor: agg._sum.netMinor ?? 0,
      distinctCustomersToday: todayCustomers.length,
      redemptionsToday: todayCount,
    };
  }

  async redemptions(userId: string, q: { cursor?: string; limit: number; storeId?: string; branchId?: string; from?: string; to?: string; status?: 'CONFIRMED' | 'VOIDED' }): Promise<Paginated<RedemptionView>> {
    const scope = await this.scope(userId, q.storeId, q.branchId);
    const where: Prisma.RedemptionWhereInput = {
      ...scope,
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to ? { businessDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    // Merchants see the customer's first name only, and never contact details or photos in lists.
    return paginateRedemptions(
      this.prisma,
      where,
      q.cursor,
      q.limit,
      (r) => {
        const rr = r as unknown as Parameters<typeof redemptionView>[0] & { user: { profile: { fullName: string } | null }; staff: { profile: { fullName: string } | null } };
        return redemptionView(rr, { customerName: firstName(rr.user.profile?.fullName), staffName: rr.staff.profile?.fullName ?? '' });
      },
      { user: { select: { profile: { select: { fullName: true } } } }, staff: { select: { profile: { select: { fullName: true } } } } },
    );
  }

  async redemption(userId: string, id: string): Promise<RedemptionView> {
    const r = await this.prisma.redemption.findUnique({ where: { id }, include: { user: { include: { profile: true } }, staff: { include: { profile: true } } } });
    if (!r) throw new AppError('NOT_FOUND');
    const acc = await this.access.accessibleBranchIds(userId);
    if (!acc.branchIds.includes(r.branchId)) throw new AppError('NOT_FOUND'); // do not reveal existence
    return redemptionView(r, { customerName: firstName(r.user.profile?.fullName), staffName: r.staff.profile?.fullName ?? '' });
  }

  // ---------------------------------------------------------------- staff management (owners only)

  async staff(userId: string, merchantId: string) {
    await this.access.requireOwner(userId, merchantId);
    const [ms, invites] = await Promise.all([
      this.prisma.merchantMembership.findMany({
        where: { merchantId },
        include: { user: { include: { profile: true } }, branches: { include: { branch: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.invitation.findMany({ where: { merchantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: this.clock.now() } }, orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      members: ms.map((m) => ({
        membershipId: m.id,
        userId: m.userId,
        fullName: m.user.profile?.fullName ?? '',
        email: m.user.email,
        role: m.role,
        active: m.active,
        branches: m.branches.map((b) => ({ id: b.branchId, name: { ar: b.branch.nameAr, en: b.branch.nameEn } })),
      })),
      pendingInvitations: invites.map((i) => ({ id: i.id, email: i.email, kind: i.kind, branchIds: i.branchIds, expiresAt: i.expiresAt.toISOString() })),
    };
  }

  private async assertBranchesOfMerchant(merchantId: string, storeId: string | null, branchIds: string[]): Promise<void> {
    const found = await this.prisma.branch.findMany({ where: { id: { in: branchIds }, store: { merchantId, ...(storeId ? { id: storeId } : {}) } }, select: { id: true } });
    if (found.length !== new Set(branchIds).size) throw new AppError('FORBIDDEN');
  }

  /** Owners may invite STAFF only (never OWNER or ADMIN), to branches of their own merchant. */
  async inviteStaff(userId: string, merchantId: string, input: { email: string; storeId: string; branchIds: string[] }, requestId?: string) {
    await this.access.requireOwner(userId, merchantId);
    await this.rateLimit.hit(`invite-staff:${userId}`, 30, 3600);
    await this.assertBranchesOfMerchant(merchantId, input.storeId, input.branchIds);
    const token = randomToken();
    const inv = await this.prisma.invitation.create({
      data: {
        email: input.email,
        kind: 'MERCHANT_STAFF',
        merchantId,
        storeId: input.storeId,
        branchIds: input.branchIds,
        tokenHash: sha256(token),
        invitedById: userId,
        expiresAt: new Date(this.clock.now().getTime() + 7 * 86400_000),
      },
    });
    await this.audit.log({ actorUserId: userId, action: 'merchant.staff_invited', entityType: 'merchant', entityId: merchantId, after: { invitationId: inv.id, email: input.email, branchIds: input.branchIds }, requestId });
    const sent = await this.mail.send({
      to: input.email,
      template: 'invite-staff',
      subject: 'دعوة للانضمام كموظف | Staff invitation',
      text: `${config().PUBLIC_APP_LINK_BASE}/invite?token=${encodeURIComponent(token)}`,
    });
    return { invitationId: inv.id, emailSent: sent };
  }

  async updateStaffBranches(userId: string, merchantId: string, membershipId: string, branchIds: string[], requestId?: string) {
    await this.access.requireOwner(userId, merchantId);
    const m = await this.prisma.merchantMembership.findUnique({ where: { id: membershipId }, include: { branches: true } });
    if (!m || m.merchantId !== merchantId) throw new AppError('NOT_FOUND');
    if (m.role !== 'STAFF') throw new AppError('FORBIDDEN');
    await this.assertBranchesOfMerchant(merchantId, null, branchIds);
    await this.prisma.$transaction(async (tx) => {
      await tx.membershipBranch.deleteMany({ where: { membershipId } });
      await tx.membershipBranch.createMany({ data: branchIds.map((b) => ({ membershipId, branchId: b })) });
      await this.audit.log({ actorUserId: userId, action: 'merchant.staff_branches_changed', entityType: 'membership', entityId: membershipId, before: { branchIds: m.branches.map((b) => b.branchId) }, after: { branchIds }, requestId }, tx);
    });
  }

  async setStaffActive(userId: string, merchantId: string, membershipId: string, active: boolean, requestId?: string) {
    await this.access.requireOwner(userId, merchantId);
    const m = await this.prisma.merchantMembership.findUnique({ where: { id: membershipId } });
    if (!m || m.merchantId !== merchantId) throw new AppError('NOT_FOUND');
    if (m.role !== 'STAFF') throw new AppError('FORBIDDEN');
    await this.prisma.$transaction(async (tx) => {
      await tx.merchantMembership.update({ where: { id: membershipId }, data: { active } });
      if (!active) {
        await tx.verificationSession.updateMany({ where: { staffUserId: m.userId, merchantId, status: { in: ['AWAITING_USER', 'PENDING_MATCH', 'MATCHED'] } }, data: { status: 'CANCELLED' } });
      }
      await this.audit.log({ actorUserId: userId, action: active ? 'merchant.staff_reactivated' : 'merchant.staff_deactivated', entityType: 'membership', entityId: membershipId, requestId }, tx);
    });
  }

  async revokeInvitation(userId: string, merchantId: string, invitationId: string) {
    await this.access.requireOwner(userId, merchantId);
    const res = await this.prisma.invitation.updateMany({ where: { id: invitationId, merchantId, kind: 'MERCHANT_STAFF', acceptedAt: null }, data: { revokedAt: this.clock.now() } });
    if (res.count !== 1) throw new AppError('NOT_FOUND');
  }
}

function firstName(full?: string | null): string {
  return (full ?? '').trim().split(/\s+/)[0] ?? '';
}

