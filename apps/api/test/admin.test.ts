import { csvCell } from '../src/modules/admin-reports.service';
import { activateMember, approvedQuote, bearer, confirm, createAdmin, createTestApp, extractToken, merchantFixture, planFixture, registerUser, resetDb, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await resetDb(ctx.prisma);
  ctx.clock.set(null);
  ctx.rateLimit.clearMemory();
  ctx.settings.invalidate();
});

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hebron' }).format(new Date());
}

describe('admin dashboard & reports', () => {
  it('distinguishes customers from transactions and active members from registrations; downloads not invented', async () => {
    const admin = await createAdmin(ctx);
    const m1 = await merchantFixture(ctx, { name: 'A' });
    const m2 = await merchantFixture(ctx, { name: 'B' });
    const u1 = await registerUser(ctx);
    const u2 = await registerUser(ctx);
    await registerUser(ctx); // registered, never activated
    await activateMember(ctx, u1, admin);
    await activateMember(ctx, u2, admin);
    for (const [u, m] of [[u1, m1], [u1, m2], [u2, m1]] as const) {
      const q = await approvedQuote(ctx, u, m.staff, m.branches[0].id, 10000);
      await confirm(ctx, m.staff, q.quote.id);
    }
    const d = await ctx.http.get(`/v1/admin/dashboard?from=${today()}&to=${today()}`).set(bearer(admin.token)).expect(200);
    expect(d.body).toMatchObject({ confirmedRedemptions: 3, customersWhoRedeemed: 2, activeMembers: 2, savingsMinor: 6000, activeStores: 2, voidedRedemptions: 0 });
    expect(d.body.registeredUsers).toBeGreaterThanOrEqual(8);
    expect(d.body.downloads).toMatchObject({ value: null, source: 'NOT_AVAILABLE' });

    const ts = await ctx.http.get(`/v1/admin/reports/timeseries?from=${today()}&to=${today()}&granularity=day`).set(bearer(admin.token)).expect(200);
    expect(ts.body.redemptions).toEqual([{ bucket: today(), count: 3, customers: 2, discountMinor: 6000, grossMinor: 30000 }]);
    expect(ts.body.topStores[0]).toMatchObject({ storeId: m1.store.id, count: 2, customers: 2 });
    expect(ts.body.newUsers[0].count).toBeGreaterThanOrEqual(8);
  });

  it('CSV export neutralizes formula injection and is audited', async () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('-2')).toBe(`"'-2"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('normal')).toBe('"normal"');
    const admin = await createAdmin(ctx);
    const m = await merchantFixture(ctx);
    await ctx.prisma.store.update({ where: { id: m.store.id }, data: { nameEn: '=cmd|calc' } });
    const u = await registerUser(ctx);
    await activateMember(ctx, u, admin);
    const q = await approvedQuote(ctx, u, m.staff, m.branches[0].id);
    await confirm(ctx, m.staff, q.quote.id);
    const csv = await ctx.http.get('/v1/admin/redemptions/export.csv').set(bearer(admin.token)).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(`"'=cmd|calc"`);
    expect(csv.text).toContain('"200.00"');
    expect(csv.text).toContain('"40.00"');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'redemptions.exported' } })).toBe(1);
  });

  it('admin permissions are enforced per area', async () => {
    const support = await createAdmin(ctx, ['USERS_MANAGE']);
    expect((await ctx.http.get('/v1/admin/users').set(bearer(support.token))).status).toBe(200);
    expect((await ctx.http.get(`/v1/admin/dashboard?from=${today()}&to=${today()}`).set(bearer(support.token))).status).toBe(403);
    expect((await ctx.http.post('/v1/admin/broadcasts').set(bearer(support.token)).send({})).status).toBe(403);
    expect((await ctx.http.patch('/v1/admin/settings').set(bearer(support.token)).send({ reason: 'x' })).status).toBe(403);
    const inv = await ctx.http.post('/v1/admin/invitations').set(bearer(support.token)).send({ email: 'a@example.test', kind: 'ADMIN', permissions: ['ADMINS_MANAGE'] });
    expect(inv.body.error.code).toBe('FORBIDDEN');
  });
});

describe('users, cards & subscriptions', () => {
  it('manual subscription grant activates the card, stacks renewals to local midnight and is audited', async () => {
    const admin = await createAdmin(ctx);
    const u = await registerUser(ctx);
    const plan = await planFixture(ctx, 30);
    ctx.clock.set(new Date('2026-03-10T08:00:00Z'));
    admin.token = (await ctx.auth.createSession(admin.userId, {}, ctx.clock.now())).accessToken;
    const g1 = await ctx.http.post(`/v1/admin/users/${u.userId}/subscriptions`).set(bearer(admin.token)).send({ planId: plan.id, reason: 'paid at office', paymentReference: 'RCPT-1' }).expect(201);
    // 30 days from 2026-03-10 local → ends at local midnight starting 2026-04-09 (UTC+3 after DST on 2026-03-27)
    expect(g1.body.endsAt).toBe('2026-04-08T21:00:00.000Z');
    const g2 = await ctx.http.post(`/v1/admin/users/${u.userId}/subscriptions`).set(bearer(admin.token)).send({ planId: plan.id, reason: 'renewal' }).expect(201);
    expect(g2.body.startsAt).toBe(g1.body.endsAt);
    const card = await ctx.prisma.card.findFirstOrThrow({ where: { userId: u.userId, isCurrent: true } });
    expect(card.status).toBe('ACTIVE');
    const audit = await ctx.prisma.auditLog.findMany({ where: { entityId: u.userId, action: 'subscription.granted' } });
    expect(audit).toHaveLength(2);
    expect(audit.every((a) => a.actorUserId === admin.userId && a.reason)).toBe(true);
    // Without an approved photo membership is not yet usable
    u.token = (await ctx.auth.createSession(u.userId, {}, null)).accessToken;
    const c = await ctx.http.get('/v1/me/card').set(bearer(u.token)).expect(200);
    expect(c.body.membership.state).toBe('PHOTO_PENDING');
  });

  it('reason is mandatory for card and status actions', async () => {
    const admin = await createAdmin(ctx);
    const u = await registerUser(ctx);
    const r = await ctx.http.post(`/v1/admin/users/${u.userId}/card`).set(bearer(admin.token)).send({ action: 'SUSPEND' });
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('user search by email, name or serial', async () => {
    const admin = await createAdmin(ctx);
    const u = await registerUser(ctx, { name: 'Unique Zaid' });
    const card = await ctx.prisma.card.findFirstOrThrow({ where: { userId: u.userId } });
    for (const q of [u.email.slice(0, 8), 'zaid', card.serialNumber.slice(3, 12)]) {
      const r = await ctx.http.get(`/v1/admin/users?q=${encodeURIComponent(q)}`).set(bearer(admin.token)).expect(200);
      expect(r.body.items.map((i: { id: string }) => i.id)).toContain(u.userId);
    }
  });
});

describe('catalog', () => {
  it('store activation requires an offer and a branch; merchant owner invitation flow', async () => {
    const admin = await createAdmin(ctx);
    const cat = await ctx.http.post('/v1/admin/categories').set(bearer(admin.token)).send({ slug: 'cafes', nameAr: 'مقاهي', nameEn: 'Cafes' }).expect(201);
    const merchant = await ctx.http.post('/v1/admin/merchants').set(bearer(admin.token)).send({ nameAr: 'شركة القهوة', nameEn: 'Coffee Co' }).expect(201);
    await ctx.http.post(`/v1/admin/merchants/${merchant.body.id}/status`).set(bearer(admin.token)).send({ status: 'ACTIVE', reason: 'contract signed' }).expect(204);
    const store = await ctx.http.post('/v1/admin/stores').set(bearer(admin.token)).send({ merchantId: merchant.body.id, categoryId: cat.body.id, nameAr: 'مقهى', nameEn: 'Cafe' }).expect(201);
    const early = await ctx.http.post(`/v1/admin/stores/${store.body.id}/status`).set(bearer(admin.token)).send({ status: 'ACTIVE', reason: 'go live' });
    expect(early.body.error.code).toBe('VALIDATION_FAILED');
    const branch = await ctx.http
      .post(`/v1/admin/stores/${store.body.id}/branches`)
      .set(bearer(admin.token))
      .send({ nameAr: 'الفرع الرئيسي', nameEn: 'Main', city: 'Hebron', openingHours: [{ day: 0, open: '08:00', close: '22:00' }] })
      .expect(201);
    const badOffer = await ctx.http.post(`/v1/admin/stores/${store.body.id}/offers`).set(bearer(admin.token)).send({ rateBps: 0, reason: 'x y z' });
    expect(badOffer.body.error.code).toBe('VALIDATION_FAILED');
    const o1 = await ctx.http.post(`/v1/admin/stores/${store.body.id}/offers`).set(bearer(admin.token)).send({ rateBps: 1500, termsAr: 'لا يشمل العروض', termsEn: 'Excludes promos', reason: 'initial' }).expect(201);
    expect(o1.body.version).toBe(1);
    const o2 = await ctx.http.post(`/v1/admin/stores/${store.body.id}/offers`).set(bearer(admin.token)).send({ rateBps: 2000, maxDiscountMinor: 5000, reason: 'raise' }).expect(201);
    expect(o2.body.version).toBe(2);
    const offers = await ctx.http.get(`/v1/admin/stores/${store.body.id}/offers`).set(bearer(admin.token)).expect(200);
    expect(offers.body.map((o: { status: string }) => o.status)).toEqual(['ACTIVE', 'SUPERSEDED']);
    await ctx.http.post(`/v1/admin/stores/${store.body.id}/status`).set(bearer(admin.token)).send({ status: 'ACTIVE', reason: 'go live' }).expect(204);

    // public directory (signed out)
    const list = await ctx.http.get('/v1/stores?city=hebron').expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ id: store.body.id, rateBps: 2000, availability: 'SIGNED_OUT', cities: ['Hebron'] });
    const detail = await ctx.http.get(`/v1/stores/${store.body.id}`).expect(200);
    expect(detail.body.offer).toMatchObject({ rateBps: 2000, maxDiscountMinor: 5000 });
    expect(detail.body.branches[0].id).toBe(branch.body.id);

    // owner invitation
    const inv = await ctx.http.post('/v1/admin/invitations').set(bearer(admin.token)).send({ email: 'owner@coffee.test', kind: 'MERCHANT_OWNER', merchantId: merchant.body.id }).expect(201);
    expect(inv.body.emailSent).toBe(false); // memory transport in tests: honestly not sent
    const token = extractToken(ctx.mail.last('owner@coffee.test')!.text);
    const acc = await ctx.http.post('/v1/auth/invitations/accept').send({ token, fullName: 'Coffee Owner', password: 'Str0ngPassw0rd!' }).expect(200);
    const ws = await ctx.http.get('/v1/me/workspaces').set(bearer(acc.body.accessToken)).expect(200);
    expect(ws.body.merchant[0]).toMatchObject({ role: 'OWNER', merchantId: merchant.body.id });
    const dash = await ctx.http.get('/v1/merchant/dashboard?period=month').set(bearer(acc.body.accessToken)).expect(200);
    expect(dash.body.redemptions).toBe(0);
  });

  it('existing accounts must re-authenticate to accept an invitation', async () => {
    const admin = await createAdmin(ctx);
    const m = await merchantFixture(ctx);
    const existing = await registerUser(ctx);
    await ctx.http.post('/v1/admin/invitations').set(bearer(admin.token)).send({ email: existing.email, kind: 'MERCHANT_STAFF', merchantId: m.merchant.id, branchIds: [m.branches[0].id] }).expect(201);
    const token = extractToken(ctx.mail.last(existing.email)!.text);
    const noPw = await ctx.http.post('/v1/auth/invitations/accept').send({ token });
    expect(noPw.body.error.code).toBe('REAUTH_REQUIRED');
    await ctx.http.post('/v1/auth/invitations/accept').send({ token, password: existing.password }).expect(200);
  });

  it('staff invitation must reference branches of the same merchant', async () => {
    const admin = await createAdmin(ctx);
    const m1 = await merchantFixture(ctx, { name: 'A' });
    const m2 = await merchantFixture(ctx, { name: 'B' });
    const r = await ctx.http.post('/v1/admin/invitations').set(bearer(admin.token)).send({ email: 'x@example.test', kind: 'MERCHANT_STAFF', merchantId: m1.merchant.id, branchIds: [m2.branches[0].id] });
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('directory availability states', () => {
  it('separates USED_TODAY, MEMBERSHIP_INACTIVE and AVAILABLE; filters by availability and rate; near me sorting', async () => {
    const admin = await createAdmin(ctx);
    const m1 = await merchantFixture(ctx, { name: 'A', rateBps: 1000 });
    const m2 = await merchantFixture(ctx, { name: 'B', rateBps: 3000 });
    const inactive = await registerUser(ctx);
    const l0 = await ctx.http.get('/v1/stores').set(bearer(inactive.token)).expect(200);
    expect(l0.body.items.every((s: { availability: string }) => s.availability === 'MEMBERSHIP_INACTIVE')).toBe(true);
    const u = await registerUser(ctx);
    await activateMember(ctx, u, admin);
    const q = await approvedQuote(ctx, u, m1.staff, m1.branches[0].id);
    await confirm(ctx, m1.staff, q.quote.id);
    const l1 = await ctx.http.get('/v1/stores').set(bearer(u.token)).expect(200);
    const byId = Object.fromEntries(l1.body.items.map((s: { id: string; availability: string }) => [s.id, s.availability]));
    expect(byId[m1.store.id]).toBe('USED_TODAY');
    expect(['AVAILABLE', 'CLOSED_NOW']).toContain(byId[m2.store.id]);
    const avail = await ctx.http.get('/v1/stores?availability=AVAILABLE').set(bearer(u.token)).expect(200);
    expect(avail.body.items.map((s: { id: string }) => s.id)).toEqual([m2.store.id]);
    const rate = await ctx.http.get('/v1/stores?minRateBps=2500').expect(200);
    expect(rate.body.items.map((s: { id: string }) => s.id)).toEqual([m2.store.id]);
    const near = await ctx.http.get('/v1/stores?lat=31.9&lng=35.2').expect(200);
    expect(near.body.items[0].distanceKm).toBeDefined();
    const page = await ctx.http.get('/v1/stores?limit=1').expect(200);
    expect(page.body.items).toHaveLength(1);
    const page2 = await ctx.http.get(`/v1/stores?limit=1&cursor=${page.body.nextCursor}`).expect(200);
    expect(page2.body.items[0].id).not.toBe(page.body.items[0].id);
  });
});

describe('settings & notifications', () => {
  it('time zone change is audited with a reason and applies to new business dates', async () => {
    const admin = await createAdmin(ctx);
    const noReason = await ctx.http.patch('/v1/admin/settings').set(bearer(admin.token)).send({ timezone: 'UTC' });
    expect(noReason.body.error.code).toBe('VALIDATION_FAILED');
    const bad = await ctx.http.patch('/v1/admin/settings').set(bearer(admin.token)).send({ timezone: 'Mars/Base', reason: 'test' });
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    await ctx.http.patch('/v1/admin/settings').set(bearer(admin.token)).send({ timezone: 'UTC', reason: 'ops decision' }).expect(200);
    const cfg = await ctx.http.get('/v1/config').expect(200);
    expect(cfg.body.timezone).toBe('UTC');
    const a = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'settings.updated' } });
    expect(a.reason).toBe('ops decision');
    expect((a.before as { timezone: string }).timezone).toBe('Asia/Hebron');
  });

  it('marketing broadcast reaches opted-in users only; preview count matches; sending is idempotent', async () => {
    const admin = await createAdmin(ctx);
    const a = await registerUser(ctx);
    const b = await registerUser(ctx);
    await ctx.http.patch('/v1/me/notification-preferences').set(bearer(a.token)).send({ marketing: true }).expect(200);
    const preview = await ctx.http.post('/v1/admin/broadcasts/preview').set(bearer(admin.token)).send({ audience: { kind: 'ALL_USERS' }, marketing: true }).expect(200);
    expect(preview.body.recipients).toBe(1);
    const bc = await ctx.http.post('/v1/admin/broadcasts').set(bearer(admin.token)).send({ titleAr: 'عرض', titleEn: 'Offer', bodyAr: 'محل جديد', bodyEn: 'New store', audience: { kind: 'ALL_USERS' }, marketing: true }).expect(201);
    await ctx.http.post(`/v1/admin/broadcasts/${bc.body.id}/schedule`).set(bearer(admin.token)).expect(200);
    await ctx.outbox.runScheduled();
    await ctx.outbox.runScheduled();
    const na = await ctx.http.get('/v1/me/notifications').set(bearer(a.token)).expect(200);
    const nb = await ctx.http.get('/v1/me/notifications').set(bearer(b.token)).expect(200);
    expect(na.body.items.filter((n: { type: string }) => n.type === 'BROADCAST')).toHaveLength(1);
    expect(nb.body.items.filter((n: { type: string }) => n.type === 'BROADCAST')).toHaveLength(0);
    const sent = await ctx.prisma.broadcast.findUniqueOrThrow({ where: { id: bc.body.id } });
    expect(sent).toMatchObject({ status: 'SENT', recipientCount: 1 });
  });

  it('expiry reminders are sent once per bucket and respect the preference', async () => {
    const admin = await createAdmin(ctx);
    const u = await registerUser(ctx);
    const off = await registerUser(ctx);
    const plan = await planFixture(ctx, 5);
    for (const x of [u, off]) await ctx.http.post(`/v1/admin/users/${x.userId}/subscriptions`).set(bearer(admin.token)).send({ planId: plan.id, reason: 'short' }).expect(201);
    await ctx.http.patch('/v1/me/notification-preferences').set(bearer(off.token)).send({ expiryReminders: false }).expect(200);
    await ctx.outbox.expiryReminders();
    await ctx.outbox.expiryReminders();
    expect(await ctx.prisma.notification.count({ where: { userId: u.userId, type: 'MEMBERSHIP_EXPIRING' } })).toBe(1);
    expect(await ctx.prisma.notification.count({ where: { userId: off.userId } })).toBe(0);
  });

  it('notification center works without push and marks read', async () => {
    const admin = await createAdmin(ctx);
    const u = await registerUser(ctx);
    await activateMember(ctx, u, admin);
    await ctx.outbox.processBatch();
    const n = await ctx.http.get('/v1/me/notifications').set(bearer(u.token)).expect(200);
    expect(n.body.unread).toBeGreaterThan(0);
    await ctx.http.post('/v1/me/notifications/read').set(bearer(u.token)).send({ ids: 'all' }).expect(204);
    const n2 = await ctx.http.get('/v1/me/notifications').set(bearer(u.token)).expect(200);
    expect(n2.body.unread).toBe(0);
  });
});

describe('ops', () => {
  it('health and readiness', async () => {
    await ctx.http.get('/health').expect(200);
    const r = await ctx.http.get('/ready').expect(200);
    expect(r.body.checks.database).toBe('ok');
  });
});
