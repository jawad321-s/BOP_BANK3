import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Audience } from '@bitaqati/shared';
import { AuditService } from '../common/audit.service';
import { Clock } from '../common/clock';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from './notifications.service';

@Injectable()
export class BroadcastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private audienceWhere(a: Audience, marketing: boolean): Prisma.UserWhereInput {
    const now = this.clock.now();
    const base: Prisma.UserWhereInput = { status: 'ACTIVE', emailVerifiedAt: { not: null }, ...(marketing ? { notificationPrefs: { marketing: true } } : {}) };
    switch (a.kind) {
      case 'ALL_USERS':
        return base;
      case 'ACTIVE_MEMBERS':
        return { ...base, subscriptions: { some: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } } } };
      case 'EXPIRING_WITHIN_DAYS':
        return { ...base, subscriptions: { some: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now, lte: new Date(now.getTime() + a.days * 86400_000) } } } };
      case 'CITY':
        return { ...base, profile: { city: { equals: a.city, mode: 'insensitive' } } };
    }
  }

  async preview(audience: Audience, marketing: boolean): Promise<{ recipients: number }> {
    return { recipients: await this.prisma.user.count({ where: this.audienceWhere(audience, marketing) }) };
  }

  list() {
    return this.prisma.broadcast.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async create(adminId: string, input: { titleAr: string; titleEn: string; bodyAr: string; bodyEn: string; audience: Audience; marketing: boolean; scheduledAt?: string }) {
    const b = await this.prisma.broadcast.create({
      data: { ...input, audience: input.audience as never, scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null, status: 'DRAFT', createdById: adminId },
    });
    await this.audit.log({ actorUserId: adminId, action: 'broadcast.created', entityType: 'broadcast', entityId: b.id, after: { audience: input.audience, marketing: input.marketing } });
    return b;
  }

  /** Schedules (or immediately queues when no time is set). Requires NOTIFICATIONS_SEND (checked by the controller). */
  async schedule(adminId: string, id: string) {
    const b = await this.prisma.broadcast.findUnique({ where: { id } });
    if (!b) throw new AppError('NOT_FOUND');
    if (b.status !== 'DRAFT') throw new AppError('CONFLICT');
    const now = this.clock.now();
    const recipients = await this.preview(b.audience as Audience, b.marketing);
    await this.prisma.broadcast.update({ where: { id }, data: { status: 'SCHEDULED', scheduledAt: b.scheduledAt ?? now, recipientCount: recipients.recipients } });
    await this.audit.log({ actorUserId: adminId, action: 'broadcast.scheduled', entityType: 'broadcast', entityId: id, after: { recipients: recipients.recipients, scheduledAt: b.scheduledAt ?? now } });
    return { status: 'SCHEDULED', recipients: recipients.recipients };
  }

  async cancel(adminId: string, id: string) {
    const res = await this.prisma.broadcast.updateMany({ where: { id, status: { in: ['DRAFT', 'SCHEDULED'] } }, data: { status: 'CANCELLED' } });
    if (res.count !== 1) throw new AppError('CONFLICT');
    await this.audit.log({ actorUserId: adminId, action: 'broadcast.cancelled', entityType: 'broadcast', entityId: id });
  }

  async sendDue(): Promise<void> {
    const now = this.clock.now();
    const due = await this.prisma.broadcast.findMany({ where: { status: 'SCHEDULED', scheduledAt: { lte: now } }, take: 5 });
    for (const b of due) {
      const claimed = await this.prisma.broadcast.updateMany({ where: { id: b.id, status: 'SCHEDULED' }, data: { status: 'SENDING' } });
      if (claimed.count !== 1) continue;
      let cursor: string | undefined;
      let count = 0;
      for (;;) {
        const users = await this.prisma.user.findMany({ where: this.audienceWhere(b.audience as Audience, b.marketing), select: { id: true }, orderBy: { id: 'asc' }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
        if (users.length === 0) break;
        for (const u of users) {
          const r = await this.notifications.notify(u.id, 'BROADCAST', { titleAr: b.titleAr, titleEn: b.titleEn, bodyAr: b.bodyAr, bodyEn: b.bodyEn }, { broadcastId: b.id }, `broadcast:${b.id}:${u.id}`, { push: true, ...(b.marketing ? { pref: 'marketing' as const } : {}) });
          if (r.created) count++;
        }
        cursor = users[users.length - 1].id;
      }
      await this.prisma.broadcast.update({ where: { id: b.id }, data: { status: 'SENT', sentAt: this.clock.now(), recipientCount: count } });
    }
  }
}
