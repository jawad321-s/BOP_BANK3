import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { NotificationType } from '@bitaqati/shared';
import { Clock } from '../common/clock';
import { logger } from '../common/logger';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis';
import { PushProvider } from './push.provider';
import type { Rendered } from './templates';

export const PUSH_QUEUE = 'push-delivery';

export interface NotifyOptions {
  push: boolean;
  /** Preference gate: if set, the user must have opted in (or not opted out) for this category. */
  pref?: 'marketing' | 'dailySummary' | 'expiryReminders';
}

/**
 * In-app notification center is the source of truth (works even when push permission is denied).
 * Push is best-effort, deduplicated per (notification, device token), retried by the queue, and its real
 * outcome is recorded in notification_deliveries.
 */
@Injectable()
export class NotificationsService implements OnModuleDestroy {
  private queue: Queue | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly redis: RedisService,
    private readonly provider: PushProvider,
  ) {}

  private getQueue(): Queue | null {
    const conn = this.redis.get();
    if (!conn || process.env.NODE_ENV === 'test') return null;
    this.queue ??= new Queue(PUSH_QUEUE, { connection: conn, defaultJobOptions: { attempts: 6, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: 5000 } });
    return this.queue;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close().catch(() => undefined);
  }

  async notify(userId: string, type: NotificationType, content: Rendered, data: Record<string, unknown>, dedupeKey: string, opts: NotifyOptions): Promise<{ created: boolean; deliveries: string[] }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { notificationPrefs: true } });
    if (!user || user.status === 'DELETED') return { created: false, deliveries: [] };
    if (opts.pref) {
      const p = user.notificationPrefs;
      const allowed = opts.pref === 'marketing' ? !!p?.marketing : opts.pref === 'dailySummary' ? !!p?.dailySummary : p?.expiryReminders !== false;
      if (!allowed) return { created: false, deliveries: [] };
    }
    const existing = await this.prisma.notification.findUnique({ where: { dedupeKey } });
    if (existing) return { created: false, deliveries: [] };
    let notificationId: string;
    try {
      const n = await this.prisma.notification.create({ data: { userId, type, data: data as never, dedupeKey, ...content } });
      notificationId = n.id;
    } catch {
      return { created: false, deliveries: [] }; // concurrent duplicate
    }
    if (!opts.push) return { created: true, deliveries: [] };
    const tokens = await this.prisma.devicePushToken.findMany({ where: { userId, disabledAt: null } });
    const deliveries: string[] = [];
    for (const t of tokens) {
      const d = await this.prisma.notificationDelivery.upsert({
        where: { notificationId_pushTokenId: { notificationId, pushTokenId: t.id } },
        create: { notificationId, pushTokenId: t.id },
        update: {},
      });
      deliveries.push(d.id);
    }
    await this.dispatch(deliveries);
    return { created: true, deliveries };
  }

  private async dispatch(ids: string[]): Promise<void> {
    const q = this.getQueue();
    for (const id of ids) {
      if (q) await q.add('deliver', { deliveryId: id }, { jobId: id });
      else await this.deliver(id).catch((e) => logger.error({ err: (e as Error).message }, 'inline push delivery failed'));
    }
  }

  /**
   * Delivers one push. Idempotent: an already SENT/SIMULATED/SKIPPED delivery is not re-sent.
   * Throws on retryable failure so the queue retries with backoff.
   */
  async deliver(deliveryId: string): Promise<void> {
    const d = await this.prisma.notificationDelivery.findUnique({ where: { id: deliveryId }, include: { notification: { include: { user: true } } } });
    if (!d || d.status === 'SENT' || d.status === 'SIMULATED' || d.status === 'SKIPPED') return;
    const token = d.pushTokenId ? await this.prisma.devicePushToken.findUnique({ where: { id: d.pushTokenId } }) : null;
    if (!token || token.disabledAt || token.userId !== d.notification.userId) {
      await this.prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'SKIPPED', lastError: 'token inactive' } });
      return;
    }
    const n = d.notification;
    const en = n.user.locale === 'en';
    const result = await this.provider.send({ token: token.token, title: en ? n.titleEn : n.titleAr, body: en ? n.bodyEn : n.bodyAr, data: { notificationId: n.id, type: n.type } });
    const attempts = d.attempts + 1;
    switch (result.status) {
      case 'SENT':
        await this.prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'SENT', attempts, providerRef: result.providerRef ?? null, lastError: null } });
        return;
      case 'SIMULATED':
        await this.prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'SIMULATED', attempts } });
        return;
      case 'INVALID_TOKEN':
        await this.prisma.$transaction([
          this.prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'FAILED', attempts, lastError: result.error } }),
          this.prisma.devicePushToken.update({ where: { id: token.id }, data: { disabledAt: this.clock.now() } }),
        ]);
        return;
      case 'FAILED':
        await this.prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: 'FAILED', attempts, lastError: result.error } });
        return;
      case 'RETRY':
        await this.prisma.notificationDelivery.update({ where: { id: d.id }, data: { attempts, lastError: result.error } });
        throw new Error(`push retry: ${result.error}`);
    }
  }
}
