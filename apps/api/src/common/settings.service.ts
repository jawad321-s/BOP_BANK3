import { Injectable } from '@nestjs/common';
import { config } from '../config';
import { PrismaService } from './prisma.service';

export interface PlatformSettings {
  appNameAr: string;
  appNameEn: string;
  supportEmail: string | null;
  supportPhone: string | null;
  privacyUrl: string | null;
  termsUrl: string | null;
  timezone: string;
  qrTtlSeconds: number;
  maxInvoiceMinor: number;
}

const KEY = 'platform';

/** Centrally configurable platform settings (identity, time zone, limits). Cached briefly. */
@Injectable()
export class SettingsService {
  private cache: { value: PlatformSettings; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  defaults(): PlatformSettings {
    const c = config();
    return {
      appNameAr: 'بطاقتي',
      appNameEn: 'Bitaqati',
      supportEmail: null,
      supportPhone: null,
      privacyUrl: null,
      termsUrl: null,
      timezone: c.DEFAULT_TIMEZONE,
      qrTtlSeconds: c.QR_TTL_SECONDS,
      maxInvoiceMinor: c.MAX_INVOICE_MINOR,
    };
  }

  async get(): Promise<PlatformSettings> {
    if (this.cache && Date.now() - this.cache.at < 5000) return this.cache.value;
    const row = await this.prisma.appSetting.findUnique({ where: { key: KEY } });
    const value = { ...this.defaults(), ...((row?.value as Partial<PlatformSettings>) ?? {}) };
    this.cache = { value, at: Date.now() };
    return value;
  }

  async update(patch: Partial<PlatformSettings>, actorId: string): Promise<{ before: PlatformSettings; after: PlatformSettings }> {
    const before = await this.get();
    const after = { ...before, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as PlatformSettings;
    await this.prisma.appSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: after as never, updatedById: actorId },
      update: { value: after as never, updatedById: actorId },
    });
    this.cache = null;
    return { before, after };
  }

  invalidate(): void {
    this.cache = null;
  }
}
