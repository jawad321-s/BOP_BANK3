import { Injectable } from '@nestjs/common';
import type { Card, Plan, Subscription, UserProfile } from '@prisma/client';
import { daysRemaining, type ErrorCode, type MembershipState, type MembershipSummary } from '@bitaqati/shared';
import { PrismaService, type Tx } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';

export interface MembershipInputs {
  userStatus: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  card: Pick<Card, 'id' | 'status' | 'isCurrent'> | null;
  hasApprovedPhoto: boolean;
  activeSubscription: (Pick<Subscription, 'endsAt' | 'startsAt'> & { plan?: Pick<Plan, 'nameAr' | 'nameEn'> }) | null;
  hadSubscriptionBefore: boolean;
}

/**
 * Eligibility is derived from card status, subscription window, approved photo and the server clock together.
 * Order matters: the most specific blocking reason is reported first.
 */
export function computeMembershipState(i: MembershipInputs): MembershipState {
  if (!i.card || !i.card.isCurrent) return 'NO_CARD';
  if (i.card.status === 'REVOKED' || i.userStatus === 'DELETED') return 'REVOKED';
  if (i.card.status === 'SUSPENDED' || i.userStatus === 'SUSPENDED') return 'SUSPENDED';
  if (i.card.status === 'EXPIRED') return 'EXPIRED';
  if (i.card.status === 'PENDING') return 'PENDING_ACTIVATION';
  if (!i.activeSubscription) return i.hadSubscriptionBefore ? 'EXPIRED' : 'PENDING_ACTIVATION';
  if (!i.hasApprovedPhoto) return 'PHOTO_PENDING';
  return 'ACTIVE';
}

export function membershipErrorCode(state: MembershipState): ErrorCode | null {
  switch (state) {
    case 'ACTIVE':
      return null;
    case 'EXPIRED':
      return 'CARD_EXPIRED';
    case 'SUSPENDED':
      return 'CARD_SUSPENDED';
    case 'REVOKED':
      return 'CARD_REVOKED';
    case 'PENDING_ACTIVATION':
      return 'CARD_PENDING';
    case 'PHOTO_PENDING':
      return 'PHOTO_NOT_APPROVED';
    case 'NO_CARD':
      return 'CARD_NOT_FOUND';
  }
}

export interface LoadedMembership {
  state: MembershipState;
  card: Card | null;
  profile: UserProfile | null;
  subscription: (Subscription & { plan: Plan }) | null;
  userStatus: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
}

@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async load(userId: string, now: Date, tx?: Tx): Promise<LoadedMembership> {
    const db = tx ?? this.prisma;
    const [user, card, subscription, pastCount] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: { status: true, profile: true } }),
      db.card.findFirst({ where: { userId, isCurrent: true } }),
      db.subscription.findFirst({
        where: { userId, status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } },
        include: { plan: true },
        orderBy: { endsAt: 'desc' },
      }),
      db.subscription.count({ where: { userId, startsAt: { lte: now } } }),
    ]);
    const userStatus = user?.status ?? 'DELETED';
    const state = computeMembershipState({
      userStatus,
      card,
      hasApprovedPhoto: !!user?.profile?.photoKey,
      activeSubscription: subscription,
      hadSubscriptionBefore: pastCount > 0,
    });
    return { state, card, profile: user?.profile ?? null, subscription, userStatus };
  }

  /** Latest end of all active subscriptions (stacked renewals), for display. */
  async summary(userId: string, now: Date): Promise<MembershipSummary & { loaded: LoadedMembership }> {
    const loaded = await this.load(userId, now);
    const { timezone } = await this.settings.get();
    let endsAt: Date | null = null;
    if (loaded.subscription) {
      const latest = await this.prisma.subscription.findFirst({
        where: { userId, status: 'ACTIVE', endsAt: { gt: now } },
        orderBy: { endsAt: 'desc' },
        select: { endsAt: true },
      });
      endsAt = latest?.endsAt ?? loaded.subscription.endsAt;
    } else {
      const last = await this.prisma.subscription.findFirst({ where: { userId, status: 'ACTIVE' }, orderBy: { endsAt: 'desc' }, select: { endsAt: true } });
      endsAt = last?.endsAt ?? null;
    }
    return {
      state: loaded.state,
      cardStatus: loaded.card?.status ?? null,
      subscriptionEndsAt: endsAt?.toISOString() ?? null,
      daysRemaining: endsAt ? daysRemaining(now, endsAt, timezone) : null,
      planName: loaded.subscription ? { ar: loaded.subscription.plan.nameAr, en: loaded.subscription.plan.nameEn } : null,
      loaded,
    };
  }
}
