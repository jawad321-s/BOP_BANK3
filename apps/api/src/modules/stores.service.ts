import { Injectable } from '@nestjs/common';
import type { Branch, Category, DiscountOffer, Prisma, Store, StoreImage } from '@prisma/client';
import { businessDate, isOpenAt, type BranchDetail, type MembershipState, type OpeningInterval, type Paginated, type StoreAvailability, type StoreDetail, type StoreSummary } from '@bitaqati/shared';
import { config } from '../config';
import { Clock } from '../common/clock';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { MembershipService } from '../domain/membership.service';

type StoreWithRelations = Store & { category: Category | null; branches: Branch[]; offers: DiscountOffer[]; images?: StoreImage[] };

export interface ViewerContext {
  signedIn: boolean;
  membership: MembershipState | null;
  usedStoreIds: Set<string>;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function mediaUrl(key: string | null | undefined): string | null {
  return key ? `${config().PUBLIC_API_URL}/v1/media/${key}` : null;
}

@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly membership: MembershipService,
  ) {}

  async viewer(userId: string | null): Promise<ViewerContext> {
    if (!userId) return { signedIn: false, membership: null, usedStoreIds: new Set() };
    const now = this.clock.now();
    const { timezone } = await this.settings.get();
    const [m, used] = await Promise.all([
      this.membership.load(userId, now),
      this.prisma.redemption.findMany({ where: { userId, status: 'CONFIRMED', businessDate: new Date(businessDate(now, timezone)) }, select: { storeId: true } }),
    ]);
    return { signedIn: true, membership: m.state, usedStoreIds: new Set(used.map((u) => u.storeId)) };
  }

  availability(store: Store, viewer: ViewerContext, openNow: boolean | null): StoreAvailability {
    if (store.status !== 'ACTIVE') return 'STORE_SUSPENDED';
    if (!viewer.signedIn) return 'SIGNED_OUT';
    if (viewer.membership !== 'ACTIVE') return 'MEMBERSHIP_INACTIVE';
    if (viewer.usedStoreIds.has(store.id)) return 'USED_TODAY';
    if (openNow === false) return 'CLOSED_NOW';
    return 'AVAILABLE';
  }

  private openNow(branches: Branch[], now: Date, tz: string): boolean | null {
    const states = branches.filter((b) => b.status === 'ACTIVE').map((b) => isOpenAt(b.openingHours as unknown as OpeningInterval[], now, tz));
    if (states.some((s) => s === true)) return true;
    if (states.length > 0 && states.every((s) => s === false)) return false;
    return null;
  }

  summary(s: StoreWithRelations, viewer: ViewerContext, now: Date, tz: string): StoreSummary {
    const offer = s.offers.find((o) => o.status === 'ACTIVE') ?? null;
    const openNow = this.openNow(s.branches, now, tz);
    return {
      id: s.id,
      name: { ar: s.nameAr, en: s.nameEn },
      category: s.category ? { id: s.category.id, name: { ar: s.category.nameAr, en: s.category.nameEn } } : null,
      logoUrl: mediaUrl(s.logoKey),
      rateBps: offer?.rateBps ?? null,
      cities: [...new Set(s.branches.filter((b) => b.status === 'ACTIVE').map((b) => b.city))],
      availability: this.availability(s, viewer, openNow),
      openNow,
    };
  }

  /** Public directory: only ACTIVE stores of ACTIVE merchants with an active offer are listed. */
  async list(userId: string | null, q: { cursor?: string; limit: number; q?: string; categoryId?: string; city?: string; minRateBps?: number; availability?: 'AVAILABLE' | 'USED_TODAY'; lat?: number; lng?: number }): Promise<Paginated<StoreSummary & { distanceKm?: number | null }>> {
    const now = this.clock.now();
    const { timezone } = await this.settings.get();
    const viewer = await this.viewer(userId);
    const where: Prisma.StoreWhereInput = {
      status: 'ACTIVE',
      merchant: { status: 'ACTIVE' },
      offers: { some: { status: 'ACTIVE', ...(q.minRateBps ? { rateBps: { gte: q.minRateBps } } : {}) } },
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.city ? { branches: { some: { city: { equals: q.city, mode: 'insensitive' }, status: 'ACTIVE' } } } : {}),
      ...(q.q
        ? { OR: [{ nameAr: { contains: q.q, mode: 'insensitive' } }, { nameEn: { contains: q.q, mode: 'insensitive' } }, { descriptionAr: { contains: q.q, mode: 'insensitive' } }, { descriptionEn: { contains: q.q, mode: 'insensitive' } }] }
        : {}),
    };
    if (q.availability === 'USED_TODAY') where.id = { in: [...viewer.usedStoreIds] };
    if (q.availability === 'AVAILABLE') where.id = { notIn: [...viewer.usedStoreIds] };

    const offset = q.cursor ? Math.max(0, parseInt(Buffer.from(q.cursor, 'base64url').toString(), 10) || 0) : 0;
    const include = { category: true, branches: { where: { status: 'ACTIVE' as const } }, offers: { where: { status: 'ACTIVE' as const } } };
    let rows: StoreWithRelations[];
    let hasMore: boolean;
    let distances = new Map<string, number | null>();
    if (q.lat !== undefined && q.lng !== undefined) {
      // "Near me": location is used for this request only and never stored.
      const all = await this.prisma.store.findMany({ where, include, take: 1000 });
      for (const s of all) {
        const ds = s.branches.filter((b) => b.lat != null && b.lng != null).map((b) => haversineKm({ lat: q.lat!, lng: q.lng! }, { lat: b.lat!, lng: b.lng! }));
        distances.set(s.id, ds.length ? Math.min(...ds) : null);
      }
      all.sort((a, b) => (distances.get(a.id) ?? Infinity) - (distances.get(b.id) ?? Infinity));
      rows = all.slice(offset, offset + q.limit);
      hasMore = all.length > offset + q.limit;
    } else {
      const found = await this.prisma.store.findMany({ where, include, orderBy: [{ nameEn: 'asc' }, { id: 'asc' }], skip: offset, take: q.limit + 1 });
      hasMore = found.length > q.limit;
      rows = found.slice(0, q.limit);
    }
    const items = rows.map((s) => ({
      ...this.summary(s, viewer, now, timezone),
      ...(distances.size ? { distanceKm: distances.get(s.id) == null ? null : Math.round(distances.get(s.id)! * 10) / 10 } : {}),
    }));
    return { items, nextCursor: hasMore ? Buffer.from(String(offset + q.limit)).toString('base64url') : null };
  }

  async detail(userId: string | null, id: string): Promise<StoreDetail> {
    const now = this.clock.now();
    const { timezone } = await this.settings.get();
    const s = await this.prisma.store.findFirst({
      where: { id, status: { in: ['ACTIVE', 'SUSPENDED'] }, merchant: { status: { not: 'PENDING' } } },
      include: { category: true, branches: { where: { status: 'ACTIVE' }, orderBy: { nameEn: 'asc' } }, offers: { where: { status: 'ACTIVE' } }, images: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!s) throw new AppError('NOT_FOUND');
    const viewer = await this.viewer(userId);
    const offer = s.offers[0] ?? null;
    const branches: BranchDetail[] = s.branches.map((b) => ({
      id: b.id,
      name: { ar: b.nameAr, en: b.nameEn },
      city: b.city,
      address: { ar: b.addressAr, en: b.addressEn },
      lat: b.lat,
      lng: b.lng,
      phone: b.phone,
      openingHours: b.openingHours as unknown as OpeningInterval[],
      openNow: isOpenAt(b.openingHours as unknown as OpeningInterval[], now, timezone),
    }));
    return {
      ...this.summary(s, viewer, now, timezone),
      description: { ar: s.descriptionAr, en: s.descriptionEn },
      images: s.images.map((i) => mediaUrl(i.key)!),
      phone: s.phone,
      website: s.website,
      instagram: s.instagram,
      offer: offer ? { rateBps: offer.rateBps, minEligibleMinor: offer.minEligibleMinor, maxDiscountMinor: offer.maxDiscountMinor, terms: { ar: offer.termsAr, en: offer.termsEn } } : null,
      branches,
    };
  }

  async categories() {
    const cats = await this.prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }] });
    return cats.map((c) => ({ id: c.id, slug: c.slug, name: { ar: c.nameAr, en: c.nameEn } }));
  }

  async cities(): Promise<string[]> {
    const rows = await this.prisma.branch.findMany({ where: { status: 'ACTIVE', store: { status: 'ACTIVE' } }, distinct: ['city'], select: { city: true }, orderBy: { city: 'asc' } });
    return rows.map((r) => r.city);
  }
}
