import { Injectable } from '@nestjs/common';
import { businessDate, daysRemaining, type Audience } from '@bitaqati/shared';
import { Clock } from '../common/clock';
import { logger } from '../common/logger';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { StorageService } from '../common/storage.service';
import { NotificationsService } from './notifications.service';
import { templates } from './templates';
import { BroadcastService } from './broadcast.service';

/**
 * Transactional-outbox dispatcher. Events are committed together with the business change and handled
 * here afterwards; failures are retried with backoff and never roll back the redemption itself.
 */
@Injectable()
export class OutboxProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly broadcasts: BroadcastService,
  ) {}

  async processBatch(limit = 50): Promise<number> {
    let processed = 0;
    for (let i = 0; i < limit; i++) {
      const handled = await this.processOne();
      if (!handled) break;
      processed++;
    }
    return processed;
  }

  private async processOne(): Promise<boolean> {
    const now = this.clock.now();
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string; type: string; payload: Record<string, unknown>; attempts: number }>>`
          SELECT id, type, payload, attempts FROM outbox_events
          WHERE processed_at IS NULL AND available_at <= ${now}
          ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
        const ev = rows[0];
        if (!ev) return false;
        try {
          await this.handle(ev.type, ev.payload);
          await tx.outboxEvent.update({ where: { id: ev.id }, data: { processedAt: this.clock.now(), attempts: ev.attempts + 1, lastError: null } });
        } catch (e) {
          const attempts = ev.attempts + 1;
          const delay = Math.min(3600_000, 2 ** attempts * 1000);
          logger.warn({ outboxId: ev.id, type: ev.type, attempts, err: (e as Error).message }, 'outbox handler failed');
          await tx.outboxEvent.update({ where: { id: ev.id }, data: { attempts, lastError: (e as Error).message.slice(0, 500), availableAt: new Date(now.getTime() + delay) } });
        }
        return true;
      },
      { timeout: 60_000 },
    );
  }

  private async owners(merchantId: string): Promise<string[]> {
    const ms = await this.prisma.merchantMembership.findMany({ where: { merchantId, role: 'OWNER', active: true }, select: { userId: true } });
    return ms.map((m) => m.userId);
  }

  async handle(type: string, p: Record<string, unknown>): Promise<void> {
    switch (type) {
      case 'redemption.confirmed': {
        const r = await this.prisma.redemption.findUniqueOrThrow({ where: { id: p.redemptionId as string } });
        await this.notifications.notify(r.userId, 'REDEMPTION_CONFIRMED', templates.REDEMPTION_CONFIRMED({ storeAr: r.storeNameAr, storeEn: r.storeNameEn, discountMinor: r.discountMinor }), { redemptionId: r.id, ref: r.ref }, `redemption.confirmed:${r.id}`, { push: true });
        for (const owner of await this.owners(r.merchantId)) {
          await this.notifications.notify(
            owner,
            'MERCHANT_REDEMPTION',
            { titleAr: 'عملية خصم جديدة', titleEn: 'New discount transaction', bodyAr: `${r.branchNameAr}: ${r.ref}`, bodyEn: `${r.branchNameEn}: ${r.ref}` },
            { redemptionId: r.id },
            `merchant.redemption:${r.id}:${owner}`,
            { push: false },
          );
        }
        return;
      }
      case 'redemption.voided': {
        const r = await this.prisma.redemption.findUniqueOrThrow({ where: { id: p.redemptionId as string } });
        await this.notifications.notify(r.userId, 'REDEMPTION_VOIDED', templates.REDEMPTION_VOIDED({ storeAr: r.storeNameAr, storeEn: r.storeNameEn }), { redemptionId: r.id, ref: r.ref }, `redemption.voided:${r.id}`, { push: true });
        for (const owner of await this.owners(r.merchantId)) {
          await this.notifications.notify(owner, 'MERCHANT_REDEMPTION', { titleAr: 'تم إلغاء عملية', titleEn: 'Transaction voided', bodyAr: r.ref, bodyEn: r.ref }, { redemptionId: r.id }, `merchant.voided:${r.id}:${owner}`, { push: false });
        }
        return;
      }
      case 'quote.created': {
        const q = await this.prisma.discountQuote.findUnique({ where: { id: p.quoteId as string }, include: { verification: { include: { store: true } } } });
        if (!q || q.status !== 'AWAITING_APPROVAL') return;
        const s = q.verification.store;
        await this.notifications.notify(q.userId, 'APPROVAL_REQUEST', templates.APPROVAL_REQUEST({ storeAr: s.nameAr, storeEn: s.nameEn }), { quoteId: q.id }, `approval:${q.id}`, { push: true });
        return;
      }
      case 'verification.requested': {
        const v = await this.prisma.verificationSession.findUnique({ where: { id: p.verificationId as string }, include: { store: true } });
        if (!v || v.status !== 'AWAITING_USER') return;
        await this.notifications.notify(v.userId, 'VERIFICATION_REQUEST', templates.VERIFICATION_REQUEST({ storeAr: v.store.nameAr, storeEn: v.store.nameEn }), { verificationId: v.id }, `verification:${v.id}`, { push: true });
        return;
      }
      case 'membership.activated':
        await this.notifications.notify(p.userId as string, 'MEMBERSHIP_ACTIVATED', templates.MEMBERSHIP_ACTIVATED(), {}, `membership.activated:${p.subscriptionId}`, { push: true });
        return;
      case 'photo.reviewed':
        await this.notifications.notify(
          p.userId as string,
          p.approved ? 'PHOTO_APPROVED' : 'PHOTO_REJECTED',
          p.approved ? templates.PHOTO_APPROVED() : templates.PHOTO_REJECTED(),
          {},
          `photo.reviewed:${p.userId}:${this.clock.now().getTime()}`,
          { push: true },
        );
        return;
      case 'account.deleted':
        for (const key of (p.storageKeys as string[]) ?? []) await this.storage.delete(key);
        return;
      default:
        logger.warn({ type }, 'unknown outbox event type');
    }
  }

  /** Periodic, idempotent jobs (dedupe keys make re-runs safe). */
  async runScheduled(): Promise<void> {
    await this.broadcasts.sendDue();
    await this.expiryReminders();
  }

  async expiryReminders(): Promise<void> {
    const now = this.clock.now();
    const { timezone } = await this.settings.get();
    const soon = new Date(now.getTime() + 8 * 86400_000);
    // Latest active subscription end per user, ending within the next 8 days or in the last day.
    const rows = await this.prisma.$queryRaw<Array<{ user_id: string; ends_at: Date }>>`
      SELECT user_id, max(ends_at) AS ends_at FROM subscriptions WHERE status = 'ACTIVE'
      GROUP BY user_id HAVING max(ends_at) BETWEEN ${new Date(now.getTime() - 86400_000)} AND ${soon}`;
    for (const r of rows) {
      const endsKey = r.ends_at.toISOString();
      if (r.ends_at <= now) {
        await this.notifications.notify(r.user_id, 'MEMBERSHIP_EXPIRED', templates.MEMBERSHIP_EXPIRED(), {}, `expired:${r.user_id}:${endsKey}`, { push: true, pref: 'expiryReminders' });
        continue;
      }
      const days = daysRemaining(now, r.ends_at, timezone);
      const bucket = days <= 1 ? 1 : days <= 7 ? 7 : null;
      if (bucket) {
        await this.notifications.notify(r.user_id, 'MEMBERSHIP_EXPIRING', templates.MEMBERSHIP_EXPIRING({ days: Math.max(days, 1) }), {}, `expiring:${r.user_id}:${endsKey}:${bucket}`, { push: true, pref: 'expiryReminders' });
      }
    }
  }

  /** Optional daily summary (opt-in), one per user per business day — never one push per store. */
  async dailySummaries(): Promise<void> {
    const now = this.clock.now();
    const { timezone } = await this.settings.get();
    const today = businessDate(now, timezone);
    const storeCount = await this.prisma.store.count({ where: { status: 'ACTIVE', merchant: { status: 'ACTIVE' }, offers: { some: { status: 'ACTIVE' } } } });
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', notificationPrefs: { dailySummary: true }, subscriptions: { some: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } } } },
      select: { id: true },
      take: 10_000,
    });
    for (const u of users) {
      await this.notifications.notify(u.id, 'DAILY_SUMMARY', templates.DAILY_SUMMARY({ count: storeCount }), {}, `daily:${u.id}:${today}`, { push: true, pref: 'dailySummary' });
    }
  }
}

export type { Audience };
