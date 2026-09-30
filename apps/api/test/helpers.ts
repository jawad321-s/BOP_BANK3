import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { resetConfigForTests } from '../src/config';
import { Clock } from '../src/common/clock';
import { MailService } from '../src/common/mail.service';
import { PrismaService } from '../src/common/prisma.service';
import { RateLimitService } from '../src/common/rate-limit.service';
import { SettingsService } from '../src/common/settings.service';
import { StorageService } from '../src/common/storage.service';
import { AuthService } from '../src/modules/auth.service';
import { OutboxProcessor } from '../src/notifications/outbox.processor';
import { ADMIN_PERMISSIONS } from '@bitaqati/shared';

export interface TestCtx {
  app: NestExpressApplication;
  http: ReturnType<typeof request>;
  prisma: PrismaService;
  clock: Clock;
  mail: MailService;
  auth: AuthService;
  storage: StorageService;
  outbox: OutboxProcessor;
  rateLimit: RateLimitService;
  settings: SettingsService;
}

export async function createTestApp(): Promise<TestCtx> {
  resetConfigForTests();
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configureApp(app);
  await app.init();
  const ctx: TestCtx = {
    app,
    http: request(app.getHttpServer()),
    prisma: app.get(PrismaService),
    clock: app.get(Clock),
    mail: app.get(MailService),
    auth: app.get(AuthService),
    storage: app.get(StorageService),
    outbox: app.get(OutboxProcessor),
    rateLimit: app.get(RateLimitService),
    settings: app.get(SettingsService),
  };
  return ctx;
}

export async function resetDb(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

let photoCache: Buffer | null = null;
export async function samplePhoto(): Promise<Buffer> {
  photoCache ??= await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 30, g: 60, b: 90 } } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: 'secret-exif-marker' } } })
    .toBuffer();
  return photoCache;
}

export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function extractToken(text: string): string {
  const m = /token=([A-Za-z0-9_%-]+)/.exec(text);
  if (!m) throw new Error('no token in mail');
  return decodeURIComponent(m[1]);
}

let counter = 0;
export function uniqueEmail(prefix = 'u'): string {
  counter++;
  return `${prefix}${counter}-${randomUUID().slice(0, 8)}@example.test`;
}

/** Registers through the public API, verifies email via the captured mail, logs in. */
export async function registerUser(ctx: TestCtx, opts: { email?: string; name?: string; password?: string } = {}) {
  ctx.rateLimit.clearMemory();
  const email = opts.email ?? uniqueEmail();
  const password = opts.password ?? 'Str0ngPassw0rd!';
  await ctx.http.post('/v1/auth/register').send({ email, password, fullName: opts.name ?? 'سارة أحمد', locale: 'ar', acceptTerms: true }).expect(202);
  const mail = ctx.mail.last(email, 'verify-email');
  await ctx.http.post('/v1/auth/verify-email').send({ token: extractToken(mail!.text) }).expect(200);
  const login = await ctx.http.post('/v1/auth/login').send({ email, password, deviceName: 'test', platform: 'ios' }).expect(200);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { email, password, userId: user.id, token: login.body.accessToken as string, refreshToken: login.body.refreshToken as string, sessionId: '' };
}

/** Admin session with MFA already verified (MFA flow itself is tested in auth.test.ts). */
export async function createAdmin(ctx: TestCtx, perms: readonly string[] = ADMIN_PERMISSIONS) {
  const u = await registerUser(ctx, { name: 'Admin User' });
  await ctx.prisma.adminPermissionGrant.createMany({ data: perms.map((p) => ({ userId: u.userId, permission: p })) });
  const tokens = await ctx.auth.createSession(u.userId, { platform: 'web' }, ctx.clock.now());
  return { ...u, token: tokens.accessToken };
}

export async function planFixture(ctx: TestCtx, days = 30) {
  return ctx.prisma.plan.create({ data: { code: `P${days}_${randomUUID().slice(0, 6).toUpperCase().replace(/-/g, '')}`, nameAr: 'شهري', nameEn: 'Monthly', durationDays: days, priceMinor: 3000 } });
}

/** Makes a registered user an ACTIVE member via the real admin endpoints (photo upload + approval + subscription). */
export async function activateMember(ctx: TestCtx, user: { userId: string; token: string }, admin: { token: string }, planId?: string) {
  const plan = planId ?? (await planFixture(ctx)).id;
  await ctx.http.post('/v1/me/photo').set(bearer(user.token)).attach('photo', await samplePhoto(), { filename: 'me.jpg', contentType: 'image/jpeg' }).expect(201);
  await ctx.http.post(`/v1/admin/users/${user.userId}/photo/review`).set(bearer(admin.token)).send({ decision: 'APPROVE' }).expect(204);
  await ctx.http.post(`/v1/admin/users/${user.userId}/subscriptions`).set(bearer(admin.token)).send({ planId: plan, reason: 'test activation' }).expect(201);
}

/** Merchant → store → branches → offer, plus owner and staff accounts with real memberships. */
export async function merchantFixture(ctx: TestCtx, opts: { rateBps?: number; branches?: number; name?: string } = {}) {
  const p = ctx.prisma;
  const merchant = await p.merchant.create({ data: { nameAr: 'تاجر', nameEn: opts.name ?? 'Merchant', status: 'ACTIVE' } });
  const category = await p.category.upsert({ where: { slug: 'food' }, create: { slug: 'food', nameAr: 'مطاعم', nameEn: 'Food' }, update: {} });
  const store = await p.store.create({ data: { merchantId: merchant.id, categoryId: category.id, nameAr: `محل ${opts.name ?? ''}`, nameEn: `Store ${opts.name ?? ''}`, status: 'ACTIVE' } });
  const branches = [];
  for (let i = 0; i < (opts.branches ?? 2); i++) {
    branches.push(await p.branch.create({ data: { storeId: store.id, nameAr: `فرع ${i + 1}`, nameEn: `Branch ${i + 1}`, city: i === 0 ? 'Ramallah' : 'Nablus', lat: 31.9 + i / 10, lng: 35.2 } }));
  }
  const offer = await p.discountOffer.create({ data: { storeId: store.id, version: 1, rateBps: opts.rateBps ?? 2000, termsAr: 'شروط', termsEn: 'Terms' } });
  const owner = await registerUser(ctx, { name: 'Owner Person' });
  await p.merchantMembership.create({ data: { userId: owner.userId, merchantId: merchant.id, role: 'OWNER' } });
  const staff = await registerUser(ctx, { name: 'Staff Person' });
  const m = await p.merchantMembership.create({ data: { userId: staff.userId, merchantId: merchant.id, role: 'STAFF' } });
  await p.membershipBranch.createMany({ data: branches.map((b) => ({ membershipId: m.id, branchId: b.id })) });
  return { merchant, store, branches, offer, owner, staff, staffMembershipId: m.id };
}

export async function qrFor(ctx: TestCtx, user: { token: string }): Promise<string> {
  const r = await ctx.http.post('/v1/me/card/qr-token').set(bearer(user.token)).expect(201);
  return r.body.payload;
}

/** Full happy path up to an approved quote. Returns ids for confirmation. */
export async function approvedQuote(ctx: TestCtx, user: { token: string }, staff: { token: string }, branchId: string, grossMinor = 20000, eligibleMinor?: number) {
  const payload = await qrFor(ctx, user);
  const v = await ctx.http.post('/v1/merchant/verifications').set(bearer(staff.token)).send({ branchId, qrPayload: payload }).expect(201);
  await ctx.http.post(`/v1/merchant/verifications/${v.body.id}/match`).set(bearer(staff.token)).send({ decision: 'MATCH' }).expect(200);
  const q = await ctx.http
    .post('/v1/merchant/quotes')
    .set(bearer(staff.token))
    .send({ verificationId: v.body.id, grossMinor, ...(eligibleMinor ? { eligibleMinor, eligibleReason: 'excluded items' } : {}) });
  if (q.status !== 201) return { verificationId: v.body.id as string, quote: null, quoteResponse: q };
  await ctx.http.post(`/v1/me/approvals/${q.body.id}/approve`).set(bearer(user.token)).send({ fingerprint: q.body.fingerprint }).expect(200);
  return { verificationId: v.body.id as string, quote: q.body, quoteResponse: q };
}

export function idemKey(): string {
  return `k_${randomUUID().replace(/-/g, '')}`;
}

export async function confirm(ctx: TestCtx, staff: { token: string }, quoteId: string, key = idemKey()) {
  return ctx.http.post('/v1/merchant/redemptions').set(bearer(staff.token)).set('Idempotency-Key', key).send({ quoteId });
}

/** After moving the simulated clock, access tokens issued "earlier" may be expired: issue fresh sessions. */
export async function renew(ctx: TestCtx, ...actors: Array<{ userId: string; token: string }>) {
  for (const a of actors) a.token = (await ctx.auth.createSession(a.userId, { platform: 'ios' }, null)).accessToken;
}
