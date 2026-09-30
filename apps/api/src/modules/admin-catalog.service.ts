import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { Clock } from '../common/clock';
import { randomToken, sha256 } from '../common/crypto';
import { AppError } from '../common/errors';
import { sanitizeImage } from '../common/image';
import { MailService } from '../common/mail.service';
import { isUniqueViolation, PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { config } from '../config';
import { mediaUrl } from './stores.service';

type Status = 'ACTIVE' | 'SUSPENDED';

@Injectable()
export class AdminCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
  ) {}

  // ---------------------------------------------------------------- merchants
  async merchants(q?: string) {
    const rows = await this.prisma.merchant.findMany({
      where: q ? { OR: [{ nameAr: { contains: q, mode: 'insensitive' } }, { nameEn: { contains: q, mode: 'insensitive' } }] } : {},
      include: { _count: { select: { stores: true, memberships: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((m) => ({ id: m.id, nameAr: m.nameAr, nameEn: m.nameEn, legalName: m.legalName, status: m.status, stores: m._count.stores, members: m._count.memberships, createdAt: m.createdAt.toISOString() }));
  }

  async merchant(id: string) {
    const m = await this.prisma.merchant.findUnique({
      where: { id },
      include: {
        stores: { include: { branches: true, offers: { orderBy: { version: 'desc' } }, category: true, images: true }, orderBy: { nameEn: 'asc' } },
        memberships: { include: { user: { include: { profile: true } }, branches: true } },
        invitations: { where: { acceptedAt: null, revokedAt: null }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!m) throw new AppError('NOT_FOUND');
    return {
      ...m,
      stores: m.stores.map((s) => ({ ...s, logoUrl: mediaUrl(s.logoKey), images: s.images.map((i) => ({ id: i.id, url: mediaUrl(i.key) })) })),
      memberships: m.memberships.map((x) => ({ id: x.id, userId: x.userId, email: x.user.email, fullName: x.user.profile?.fullName ?? '', role: x.role, active: x.active, branchIds: x.branches.map((b) => b.branchId) })),
      invitations: m.invitations.map((i) => ({ id: i.id, email: i.email, kind: i.kind, expiresAt: i.expiresAt, branchIds: i.branchIds })),
    };
  }

  async createMerchant(adminId: string, data: { nameAr: string; nameEn: string; legalName?: string; contactEmail?: string; contactPhone?: string }, requestId?: string) {
    const m = await this.prisma.merchant.create({ data });
    await this.audit.log({ actorUserId: adminId, action: 'merchant.created', entityType: 'merchant', entityId: m.id, after: data, requestId });
    return m;
  }

  async updateMerchant(adminId: string, id: string, data: Partial<{ nameAr: string; nameEn: string; legalName: string; contactEmail: string; contactPhone: string }>, requestId?: string) {
    const before = await this.prisma.merchant.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND');
    const m = await this.prisma.merchant.update({ where: { id }, data });
    await this.audit.log({ actorUserId: adminId, action: 'merchant.updated', entityType: 'merchant', entityId: id, before, after: data, requestId });
    return m;
  }

  async setMerchantStatus(adminId: string, id: string, status: Status, reason: string, requestId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.merchant.findUnique({ where: { id } });
      if (!before) throw new AppError('NOT_FOUND');
      await tx.merchant.update({ where: { id }, data: { status, statusReason: reason } });
      if (status === 'SUSPENDED') await this.invalidateOpenFlows(tx, { store: { merchantId: id } });
      await this.audit.log({ actorUserId: adminId, action: `merchant.${status.toLowerCase()}`, entityType: 'merchant', entityId: id, reason, before: { status: before.status }, after: { status }, requestId }, tx);
    });
  }

  private async invalidateOpenFlows(tx: Prisma.TransactionClient, where: { storeId?: string; store?: { merchantId: string }; branchId?: string }) {
    const vWhere: Prisma.VerificationSessionWhereInput = { status: { in: ['AWAITING_USER', 'PENDING_MATCH', 'MATCHED'] }, ...(where.storeId ? { storeId: where.storeId } : {}), ...(where.branchId ? { branchId: where.branchId } : {}), ...(where.store ? { store: where.store } : {}) };
    const qWhere: Prisma.DiscountQuoteWhereInput = { status: { in: ['AWAITING_APPROVAL', 'APPROVED'] }, verification: vWhere };
    await tx.discountQuote.updateMany({ where: qWhere, data: { status: 'SUPERSEDED' } });
    await tx.verificationSession.updateMany({ where: vWhere, data: { status: 'CANCELLED' } });
  }

  // ---------------------------------------------------------------- categories
  categories() {
    return this.prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }] });
  }
  async createCategory(adminId: string, data: { slug: string; nameAr: string; nameEn: string; sortOrder: number }) {
    try {
      const c = await this.prisma.category.create({ data });
      await this.audit.log({ actorUserId: adminId, action: 'category.created', entityType: 'category', entityId: c.id, after: data });
      return c;
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError('CONFLICT');
      throw e;
    }
  }
  async updateCategory(adminId: string, id: string, data: Partial<{ slug: string; nameAr: string; nameEn: string; sortOrder: number }>) {
    const c = await this.prisma.category.update({ where: { id }, data });
    await this.audit.log({ actorUserId: adminId, action: 'category.updated', entityType: 'category', entityId: id, after: data });
    return c;
  }

  // ---------------------------------------------------------------- stores & branches
  async createStore(adminId: string, data: { merchantId: string; categoryId: string; nameAr: string; nameEn: string; descriptionAr: string; descriptionEn: string; phone?: string; website?: string; instagram?: string }, requestId?: string) {
    const s = await this.prisma.store.create({ data: { ...data, status: 'PENDING' } });
    await this.audit.log({ actorUserId: adminId, action: 'store.created', entityType: 'store', entityId: s.id, after: data, requestId });
    return s;
  }

  async updateStore(adminId: string, id: string, data: Partial<{ categoryId: string; nameAr: string; nameEn: string; descriptionAr: string; descriptionEn: string; phone: string; website: string; instagram: string }>, requestId?: string) {
    const before = await this.prisma.store.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND');
    const { merchantId: _ignored, ...safe } = data as Record<string, unknown>;
    const s = await this.prisma.store.update({ where: { id }, data: safe });
    await this.audit.log({ actorUserId: adminId, action: 'store.updated', entityType: 'store', entityId: id, before, after: safe, requestId });
    return s;
  }

  async setStoreStatus(adminId: string, id: string, status: Status, reason: string, requestId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.store.findUnique({ where: { id }, include: { offers: { where: { status: 'ACTIVE' } }, branches: true } });
      if (!before) throw new AppError('NOT_FOUND');
      if (status === 'ACTIVE' && (before.offers.length === 0 || before.branches.length === 0)) {
        throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'store', message: 'an active offer and at least one branch are required before activation' }] });
      }
      await tx.store.update({ where: { id }, data: { status, statusReason: reason } });
      if (status === 'SUSPENDED') await this.invalidateOpenFlows(tx, { storeId: id });
      await this.audit.log({ actorUserId: adminId, action: `store.${status.toLowerCase()}`, entityType: 'store', entityId: id, reason, before: { status: before.status }, after: { status }, requestId }, tx);
    });
  }

  async uploadStoreImage(adminId: string, storeId: string, kind: 'logo' | 'gallery', file: Buffer | undefined) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw new AppError('NOT_FOUND');
    const clean = await sanitizeImage(file, kind === 'logo' ? 512 : 1600);
    const key = `stores/${storeId}/${randomToken(12)}.jpg`;
    await this.storage.put(key, clean, 'image/jpeg');
    if (kind === 'logo') {
      await this.prisma.store.update({ where: { id: storeId }, data: { logoKey: key } });
      if (store.logoKey) await this.storage.delete(store.logoKey).catch(() => undefined);
    } else {
      const count = await this.prisma.storeImage.count({ where: { storeId } });
      if (count >= 10) throw new AppError('UPLOAD_INVALID');
      await this.prisma.storeImage.create({ data: { storeId, key, sortOrder: count } });
    }
    await this.audit.log({ actorUserId: adminId, action: `store.${kind}_uploaded`, entityType: 'store', entityId: storeId });
    return { url: mediaUrl(key) };
  }

  async deleteStoreImage(adminId: string, storeId: string, imageId: string) {
    const img = await this.prisma.storeImage.findUnique({ where: { id: imageId } });
    if (!img || img.storeId !== storeId) throw new AppError('NOT_FOUND');
    await this.prisma.storeImage.delete({ where: { id: imageId } });
    await this.storage.delete(img.key).catch(() => undefined);
    await this.audit.log({ actorUserId: adminId, action: 'store.image_deleted', entityType: 'store', entityId: storeId });
  }

  async createBranch(adminId: string, storeId: string, data: Record<string, unknown>, requestId?: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw new AppError('NOT_FOUND');
    const b = await this.prisma.branch.create({ data: { ...(data as Record<string, unknown>), storeId } as never });
    await this.audit.log({ actorUserId: adminId, action: 'branch.created', entityType: 'branch', entityId: b.id, after: data, requestId });
    return b;
  }

  async updateBranch(adminId: string, id: string, data: Record<string, unknown>, requestId?: string) {
    const before = await this.prisma.branch.findUnique({ where: { id } });
    if (!before) throw new AppError('NOT_FOUND');
    const { storeId: _ignored, ...safe } = data;
    const b = await this.prisma.branch.update({ where: { id }, data: safe as never });
    await this.audit.log({ actorUserId: adminId, action: 'branch.updated', entityType: 'branch', entityId: id, before, after: safe, requestId });
    return b;
  }

  async setBranchStatus(adminId: string, id: string, status: Status, reason: string, requestId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.branch.findUnique({ where: { id } });
      if (!before) throw new AppError('NOT_FOUND');
      await tx.branch.update({ where: { id }, data: { status } });
      if (status === 'SUSPENDED') await this.invalidateOpenFlows(tx, { branchId: id });
      await this.audit.log({ actorUserId: adminId, action: `branch.${status.toLowerCase()}`, entityType: 'branch', entityId: id, reason, before: { status: before.status }, after: { status }, requestId }, tx);
    });
  }

  // ---------------------------------------------------------------- offers (versioned)
  offers(storeId: string) {
    return this.prisma.discountOffer.findMany({ where: { storeId }, orderBy: { version: 'desc' } });
  }

  /**
   * Publishes a new offer version. The previous version is superseded and every open quote/approval for the
   * store is invalidated in the same transaction (QUOTE_CHANGED → re-quote + new customer approval).
   * Confirmed redemptions keep their own snapshot and are never modified.
   */
  async publishOffer(adminId: string, storeId: string, data: { rateBps: number; minEligibleMinor?: number | null; maxDiscountMinor?: number | null; termsAr: string; termsEn: string; reason: string }, requestId?: string) {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const store = await tx.store.findUnique({ where: { id: storeId } });
      if (!store) throw new AppError('NOT_FOUND');
      await tx.$queryRaw`SELECT id FROM stores WHERE id = ${storeId}::uuid FOR UPDATE`;
      const current = await tx.discountOffer.findFirst({ where: { storeId, status: 'ACTIVE' } });
      const last = await tx.discountOffer.findFirst({ where: { storeId }, orderBy: { version: 'desc' } });
      if (current) await tx.discountOffer.update({ where: { id: current.id }, data: { status: 'SUPERSEDED', supersededAt: now } });
      await tx.discountQuote.updateMany({ where: { storeId, status: { in: ['AWAITING_APPROVAL', 'APPROVED'] } }, data: { status: 'SUPERSEDED' } });
      const offer = await tx.discountOffer.create({
        data: {
          storeId,
          version: (last?.version ?? 0) + 1,
          rateBps: data.rateBps,
          minEligibleMinor: data.minEligibleMinor ?? null,
          maxDiscountMinor: data.maxDiscountMinor ?? null,
          termsAr: data.termsAr,
          termsEn: data.termsEn,
          createdById: adminId,
        },
      });
      await this.audit.log({ actorUserId: adminId, action: 'offer.published', entityType: 'store', entityId: storeId, reason: data.reason, before: current ? { version: current.version, rateBps: current.rateBps } : null, after: { version: offer.version, rateBps: offer.rateBps, minEligibleMinor: offer.minEligibleMinor, maxDiscountMinor: offer.maxDiscountMinor }, requestId }, tx);
      return offer;
    });
  }

  async deactivateOffer(adminId: string, storeId: string, reason: string, requestId?: string) {
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.discountOffer.findFirst({ where: { storeId, status: 'ACTIVE' } });
      if (!current) throw new AppError('NO_ACTIVE_OFFER');
      await tx.discountOffer.update({ where: { id: current.id }, data: { status: 'INACTIVE', supersededAt: now } });
      await tx.discountQuote.updateMany({ where: { storeId, status: { in: ['AWAITING_APPROVAL', 'APPROVED'] } }, data: { status: 'SUPERSEDED' } });
      await this.audit.log({ actorUserId: adminId, action: 'offer.deactivated', entityType: 'store', entityId: storeId, reason, before: { version: current.version }, requestId }, tx);
    });
  }

  // ---------------------------------------------------------------- plans
  plans() {
    return this.prisma.plan.findMany({ orderBy: { createdAt: 'asc' } });
  }
  async createPlan(adminId: string, data: { code: string; nameAr: string; nameEn: string; durationDays: number; priceMinor: number; active: boolean }) {
    try {
      const p = await this.prisma.plan.create({ data });
      await this.audit.log({ actorUserId: adminId, action: 'plan.created', entityType: 'plan', entityId: p.id, after: data });
      return p;
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError('CONFLICT');
      throw e;
    }
  }
  async updatePlan(adminId: string, id: string, data: Partial<{ nameAr: string; nameEn: string; active: boolean; priceMinor: number }>) {
    // Duration and code are immutable once created so history stays meaningful; create a new plan instead.
    const { nameAr, nameEn, active, priceMinor } = data;
    const p = await this.prisma.plan.update({ where: { id }, data: { nameAr, nameEn, active, priceMinor } });
    await this.audit.log({ actorUserId: adminId, action: 'plan.updated', entityType: 'plan', entityId: id, after: data });
    return p;
  }

  // ---------------------------------------------------------------- invitations
  async invite(adminId: string, input: { email: string; kind: 'MERCHANT_OWNER' | 'MERCHANT_STAFF' | 'ADMIN'; merchantId?: string; storeId?: string; branchIds?: string[]; permissions?: string[] }, adminPerms: Set<string>, requestId?: string) {
    if (input.kind === 'ADMIN') {
      if (!adminPerms.has('ADMINS_MANAGE')) throw new AppError('FORBIDDEN');
      if (!input.permissions?.length) throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'permissions', message: 'required' }] });
    } else {
      if (!adminPerms.has('MERCHANTS_MANAGE')) throw new AppError('FORBIDDEN');
      if (!input.merchantId) throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'merchantId', message: 'required' }] });
      const m = await this.prisma.merchant.findUnique({ where: { id: input.merchantId } });
      if (!m) throw new AppError('NOT_FOUND');
      if (input.kind === 'MERCHANT_STAFF') {
        const ids = input.branchIds ?? [];
        const found = await this.prisma.branch.count({ where: { id: { in: ids }, store: { merchantId: input.merchantId } } });
        if (ids.length === 0 || found !== new Set(ids).size) throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'branchIds', message: 'must be branches of this merchant' }] });
      }
    }
    const token = randomToken();
    const inv = await this.prisma.invitation.create({
      data: {
        email: input.email,
        kind: input.kind,
        merchantId: input.kind === 'ADMIN' ? null : input.merchantId,
        storeId: input.storeId ?? null,
        branchIds: input.kind === 'MERCHANT_STAFF' ? input.branchIds ?? [] : [],
        permissions: input.kind === 'ADMIN' ? input.permissions ?? [] : [],
        tokenHash: sha256(token),
        invitedById: adminId,
        expiresAt: new Date(this.clock.now().getTime() + 7 * 86400_000),
      },
    });
    await this.audit.log({ actorUserId: adminId, action: 'invitation.created', entityType: 'invitation', entityId: inv.id, after: { email: input.email, kind: input.kind, merchantId: input.merchantId, permissions: input.permissions, branchIds: input.branchIds }, requestId });
    const sent = await this.mail.send({
      to: input.email,
      template: `invite-${input.kind.toLowerCase()}`,
      subject: 'دعوة | Invitation — Bitaqati',
      text: `${config().PUBLIC_APP_LINK_BASE}/invite?token=${encodeURIComponent(token)}`,
    });
    return { invitationId: inv.id, emailSent: sent };
  }

  async revokeInvitation(adminId: string, id: string) {
    const res = await this.prisma.invitation.updateMany({ where: { id, acceptedAt: null, revokedAt: null }, data: { revokedAt: this.clock.now() } });
    if (res.count !== 1) throw new AppError('NOT_FOUND');
    await this.audit.log({ actorUserId: adminId, action: 'invitation.revoked', entityType: 'invitation', entityId: id });
  }

  async setMembershipActive(adminId: string, membershipId: string, active: boolean, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const m = await tx.merchantMembership.findUnique({ where: { id: membershipId } });
      if (!m) throw new AppError('NOT_FOUND');
      await tx.merchantMembership.update({ where: { id: membershipId }, data: { active } });
      await this.audit.log({ actorUserId: adminId, action: active ? 'membership.activated' : 'membership.deactivated', entityType: 'membership', entityId: membershipId, reason }, tx);
    });
  }
}
