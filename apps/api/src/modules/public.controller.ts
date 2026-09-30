import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { storesQuerySchema } from '@bitaqati/shared';
import type { z } from 'zod';
import { MaybeAuth, OptionalAuth, Public } from '../common/decorators';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis';
import type { AuthContext } from '../common/request-context';
import { SettingsService } from '../common/settings.service';
import { StorageService } from '../common/storage.service';
import { DocQuery, ZQuery } from '../common/zod';
import { StoresService } from './stores.service';

@ApiTags('public')
@Controller()
export class PublicController {
  constructor(
    private readonly stores: StoresService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  /** Readiness: database reachable (and Redis when configured). */
  @Public()
  @Get('ready')
  async ready(@Res() res: Response) {
    const checks: Record<string, string> = {};
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'fail';
    }
    const r = this.redis.get();
    if (r) checks.redis = await r.ping().then(() => 'ok').catch(() => 'fail');
    const ok = Object.values(checks).every((v) => v === 'ok');
    res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'not_ready', checks });
  }

  @Public()
  @Get('v1/config')
  async config() {
    const s = await this.settings.get();
    return {
      appName: { ar: s.appNameAr, en: s.appNameEn },
      supportEmail: s.supportEmail,
      supportPhone: s.supportPhone,
      privacyUrl: s.privacyUrl,
      termsUrl: s.termsUrl,
      timezone: s.timezone,
      currency: 'ILS',
      qrTtlSeconds: s.qrTtlSeconds,
      maxInvoiceMinor: s.maxInvoiceMinor,
    };
  }

  @OptionalAuth()
  @Get('v1/stores')
  @DocQuery(storesQuerySchema)
  list(@MaybeAuth() a: AuthContext | null, @ZQuery(storesQuerySchema) q: z.infer<typeof storesQuerySchema>) {
    return this.stores.list(a?.userId ?? null, q);
  }

  @OptionalAuth()
  @Get('v1/stores/:id')
  detail(@MaybeAuth() a: AuthContext | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.stores.detail(a?.userId ?? null, id);
  }

  @Public()
  @Get('v1/categories')
  categories() {
    return this.stores.categories();
  }

  @Public()
  @Get('v1/cities')
  cities() {
    return this.stores.cities();
  }

  /** Public store media only (logos, gallery). Profile photos are never served here. */
  @Public()
  @Get('v1/media/stores/:storeId/:file')
  async media(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('file') file: string, @Res() res: Response) {
    if (!/^[A-Za-z0-9_-]{8,64}\.jpg$/.test(file)) throw new AppError('NOT_FOUND');
    const buf = await this.storage.get(`stores/${storeId}/${file}`);
    if (!buf) throw new AppError('NOT_FOUND');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(buf);
  }
}
