import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { businessDate, minorToDecimalString, startOfBusinessDay, addDays } from '@bitaqati/shared';
import { Clock } from '../common/clock';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { redemptionView } from '../domain/views';
import { paginateRedemptions } from './me.service';
import { AppError } from '../common/errors';

/** Neutralize spreadsheet formula injection and quote for CSV. */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

@Injectable()
export class AdminReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
  ) {}

  /** Platform KPIs. Definitions: docs/metrics.md. */
  async dashboard(from: string, to: string) {
    const now = this.clock.now();
    const { timezone } = await this.settings.get();
    const fromTs = startOfBusinessDay(from, timezone);
    const toTs = startOfBusinessDay(addDays(to, 1), timezone);
    const range = { gte: new Date(from), lte: new Date(to) };
    const [registered, newUsers, activeMembers, customers, confirmed, voids, activeStores, activeBranches] = await Promise.all([
      this.prisma.user.count({ where: { status: { not: 'DELETED' } } }),
      this.prisma.user.count({ where: { status: { not: 'DELETED' }, createdAt: { gte: fromTs, lt: toTs } } }),
      this.prisma.card.count({
        where: {
          isCurrent: true,
          status: 'ACTIVE',
          user: { status: 'ACTIVE', profile: { photoKey: { not: null } }, subscriptions: { some: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } } } },
        },
      }),
      this.prisma.redemption.findMany({ where: { status: 'CONFIRMED', businessDate: range }, distinct: ['userId'], select: { userId: true } }),
      this.prisma.redemption.aggregate({ where: { status: 'CONFIRMED', businessDate: range }, _count: { _all: true }, _sum: { discountMinor: true, grossMinor: true } }),
      this.prisma.redemption.count({ where: { status: 'VOIDED', voidedAt: { gte: fromTs, lt: toTs } } }),
      this.prisma.store.count({ where: { status: 'ACTIVE', merchant: { status: 'ACTIVE' }, offers: { some: { status: 'ACTIVE' } } } }),
      this.prisma.branch.count({ where: { status: 'ACTIVE', store: { status: 'ACTIVE', merchant: { status: 'ACTIVE' } } } }),
    ]);
    return {
      period: { from, to, timezone },
      registeredUsers: registered,
      newUsers,
      activeMembers,
      customersWhoRedeemed: customers.length,
      confirmedRedemptions: confirmed._count._all,
      voidedRedemptions: voids,
      savingsMinor: confirmed._sum.discountMinor ?? 0,
      grossMinor: confirmed._sum.grossMinor ?? 0,
      activeStores,
      activeBranches,
      downloads: { value: null, source: 'NOT_AVAILABLE', note: 'App Store Connect integration not configured' },
    };
  }

  async timeseries(q: { from: string; to: string; granularity: 'day' | 'week' | 'month'; storeId?: string; branchId?: string }) {
    const { timezone } = await this.settings.get();
    const days = (Date.parse(q.to) - Date.parse(q.from)) / 86400_000;
    if (days < 0 || days > 366 * 3) throw new AppError('VALIDATION_FAILED');
    const g = Prisma.raw(`'${q.granularity}'`);
    const storeFilter = q.storeId ? Prisma.sql`AND store_id = ${q.storeId}::uuid` : Prisma.empty;
    const branchFilter = q.branchId ? Prisma.sql`AND branch_id = ${q.branchId}::uuid` : Prisma.empty;
    const redemptions = await this.prisma.$queryRaw<Array<{ bucket: Date; count: bigint; customers: bigint; discount: bigint | null; gross: bigint | null }>>`
      SELECT date_trunc(${g}, business_date)::date AS bucket, count(*) AS count, count(DISTINCT user_id) AS customers,
             sum(discount_minor) AS discount, sum(gross_minor) AS gross
      FROM redemptions
      WHERE status = 'CONFIRMED' AND business_date BETWEEN ${q.from}::date AND ${q.to}::date ${storeFilter} ${branchFilter}
      GROUP BY 1 ORDER BY 1`;
    const users = await this.prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
      SELECT date_trunc(${g}, (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}))::date AS bucket, count(*) AS count
      FROM users
      WHERE status <> 'DELETED' AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})::date BETWEEN ${q.from}::date AND ${q.to}::date
      GROUP BY 1 ORDER BY 1`;
    const top = await this.prisma.$queryRaw<Array<{ store_id: string; name_ar: string; name_en: string; count: bigint; customers: bigint; discount: bigint }>>`
      SELECT r.store_id, s.name_ar, s.name_en, count(*) AS count, count(DISTINCT r.user_id) AS customers, sum(r.discount_minor) AS discount
      FROM redemptions r JOIN stores s ON s.id = r.store_id
      WHERE r.status = 'CONFIRMED' AND r.business_date BETWEEN ${q.from}::date AND ${q.to}::date ${storeFilter} ${branchFilter}
      GROUP BY r.store_id, s.name_ar, s.name_en ORDER BY count(*) DESC LIMIT 10`;
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return {
      timezone,
      granularity: q.granularity,
      redemptions: redemptions.map((r) => ({ bucket: iso(r.bucket), count: Number(r.count), customers: Number(r.customers), discountMinor: Number(r.discount ?? 0), grossMinor: Number(r.gross ?? 0) })),
      newUsers: users.map((u) => ({ bucket: iso(u.bucket), count: Number(u.count) })),
      topStores: top.map((t) => ({ storeId: t.store_id, name: { ar: t.name_ar, en: t.name_en }, count: Number(t.count), customers: Number(t.customers), discountMinor: Number(t.discount) })),
    };
  }

  private redemptionWhere(q: { ref?: string; userId?: string; userEmail?: string; storeId?: string; from?: string; to?: string; status?: 'CONFIRMED' | 'VOIDED' }): Prisma.RedemptionWhereInput {
    return {
      ...(q.ref ? { ref: { contains: q.ref.toUpperCase() } } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.userEmail ? { user: { email: { contains: q.userEmail.toLowerCase() } } } : {}),
      ...(q.storeId ? { storeId: q.storeId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to ? { businessDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
  }

  redemptions(q: { cursor?: string; limit: number; ref?: string; userId?: string; userEmail?: string; storeId?: string; from?: string; to?: string; status?: 'CONFIRMED' | 'VOIDED' }) {
    return paginateRedemptions(
      this.prisma,
      this.redemptionWhere(q),
      q.cursor,
      q.limit,
      (r) => {
        const rr = r as unknown as Parameters<typeof redemptionView>[0] & { user: { email: string; profile: { fullName: string } | null }; staff: { email: string; profile: { fullName: string } | null } };
        return { ...redemptionView(rr, { customerName: rr.user.profile?.fullName ?? '', staffName: rr.staff.profile?.fullName ?? '' }), userId: rr.userId, customerEmail: rr.user.email, staffEmail: rr.staff.email };
      },
      { user: { select: { email: true, profile: { select: { fullName: true } } } }, staff: { select: { email: true, profile: { select: { fullName: true } } } } },
    );
  }

  async redemption(id: string) {
    const r = await this.prisma.redemption.findUnique({
      where: { id },
      include: { events: { orderBy: { createdAt: 'asc' } }, user: { include: { profile: true } }, staff: { include: { profile: true } } },
    });
    if (!r) throw new AppError('NOT_FOUND');
    return {
      ...redemptionView(r, { customerName: r.user.profile?.fullName ?? '', staffName: r.staff.profile?.fullName ?? '' }),
      userId: r.userId,
      customerEmail: r.user.email,
      offerVersion: r.offerVersion,
      eligibleReason: r.eligibleReason,
      termsSnapshot: r.termsSnapshot,
      events: r.events.map((e) => ({ id: e.id, type: e.type, actorUserId: e.actorUserId, reason: e.reason, createdAt: e.createdAt.toISOString() })),
    };
  }

  async exportCsv(q: { ref?: string; userId?: string; userEmail?: string; storeId?: string; from?: string; to?: string; status?: 'CONFIRMED' | 'VOIDED' }): Promise<string> {
    const rows = await this.prisma.redemption.findMany({ where: this.redemptionWhere(q), orderBy: { confirmedAt: 'desc' }, take: 50_000, include: { user: { select: { email: true } } } });
    const header = ['ref', 'status', 'business_date', 'timezone', 'confirmed_at_utc', 'store_en', 'branch_en', 'customer_email', 'gross_ils', 'eligible_ils', 'rate_percent', 'discount_ils', 'net_ils', 'voided_at_utc', 'void_reason'];
    const lines = [header.map(csvCell).join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.ref,
          r.status,
          r.businessDate.toISOString().slice(0, 10),
          r.timezone,
          r.confirmedAt.toISOString(),
          r.storeNameEn,
          r.branchNameEn,
          r.user.email,
          minorToDecimalString(r.grossMinor),
          minorToDecimalString(r.eligibleMinor),
          (r.rateBps / 100).toFixed(2),
          minorToDecimalString(r.discountMinor),
          minorToDecimalString(r.netMinor),
          r.voidedAt?.toISOString() ?? '',
          r.voidReason ?? '',
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  async auditLogs(q: { cursor?: string; limit: number; entityType?: string; entityId?: string; action?: string }) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.cursor ? { createdAt: { lt: new Date(Buffer.from(q.cursor, 'base64url').toString()) } } : {}),
    };
    const rows = await this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: q.limit + 1 });
    const hasMore = rows.length > q.limit;
    const items = rows.slice(0, q.limit);
    return { items, nextCursor: hasMore ? Buffer.from(items[items.length - 1].createdAt.toISOString()).toString('base64url') : null };
  }

  todayRange = async () => {
    const { timezone } = await this.settings.get();
    const today = businessDate(this.clock.now(), timezone);
    return { today, timezone };
  };
}
