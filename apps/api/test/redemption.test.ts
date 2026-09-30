import { renew, activateMember, approvedQuote, bearer, confirm, createAdmin, createTestApp, idemKey, merchantFixture, planFixture, qrFor, registerUser, resetDb, type TestCtx } from './helpers';

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

async function world(opts: { rateBps?: number } = {}) {
  const admin = await createAdmin(ctx);
  const m1 = await merchantFixture(ctx, { name: 'A', rateBps: opts.rateBps });
  const m2 = await merchantFixture(ctx, { name: 'B' });
  const user = await registerUser(ctx, { name: 'Member One' });
  await activateMember(ctx, user, admin);
  return { admin, m1, m2, user };
}

describe('money & confirmation', () => {
  it('acceptance: 200 ₪ at 20% → saves 40 ₪, pays 160 ₪; history & snapshot persisted', async () => {
    const { m1, m2, user } = await world();
    const { quote } = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id, 20000);
    expect(quote).toMatchObject({ grossMinor: 20000, eligibleMinor: 20000, rateBps: 2000, discountMinor: 4000, netMinor: 16000 });
    const r = await confirm(ctx, m1.staff, quote.id);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'CONFIRMED', discountMinor: 4000, netMinor: 16000, currency: 'ILS', timezone: 'Asia/Hebron' });
    expect(r.body.ref).toMatch(/^R-\d{8}-[0-9A-Z]{6}$/);

    const usage = await ctx.http.get('/v1/me/usage').set(bearer(user.token)).expect(200);
    expect(usage.body.items).toHaveLength(1);
    expect(usage.body.items[0]).toMatchObject({ ref: r.body.ref, discountMinor: 4000, branch: { id: m1.branches[0].id } });

    const home = await ctx.http.get('/v1/me/home').set(bearer(user.token)).expect(200);
    expect(home.body.stats).toEqual({ distinctStoresUsed: 1, totalRedemptions: 1, todayRedemptions: 1, totalSavingsMinor: 4000 });
    expect(home.body.usedToday.map((s: { id: string }) => s.id)).toEqual([m1.store.id]);
    expect(home.body.usedToday[0].availability).toBe('USED_TODAY');
    expect(home.body.availableToday.map((s: { id: string }) => s.id)).toEqual([m2.store.id]);
  });

  it('partial eligible amount: discount on eligible only, net from gross; reason required', async () => {
    const { m1, user } = await world();
    const { quote } = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id, 30000, 20000);
    expect(quote).toMatchObject({ grossMinor: 30000, eligibleMinor: 20000, discountMinor: 4000, netMinor: 26000, eligibleReason: 'excluded items' });
    // eligible > gross rejected by the server even if the client sends it
    const v = await ctx.prisma.verificationSession.findFirstOrThrow({});
    const bad = await ctx.http.post('/v1/merchant/quotes').set(bearer(m1.staff.token)).send({ verificationId: v.id, grossMinor: 100, eligibleMinor: 200, eligibleReason: 'x' });
    expect(bad.body.error.code).toBe('ELIGIBLE_EXCEEDS_GROSS');
    const zero = await ctx.http.post('/v1/merchant/quotes').set(bearer(m1.staff.token)).send({ verificationId: v.id, grossMinor: 0 });
    expect(zero.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('merchant cannot supply the rate or final amount (extra fields ignored; server computes)', async () => {
    const { m1, user } = await world();
    const payload = await qrFor(ctx, user);
    const v = await ctx.http.post('/v1/merchant/verifications').set(bearer(m1.staff.token)).send({ branchId: m1.branches[0].id, qrPayload: payload }).expect(201);
    await ctx.http.post(`/v1/merchant/verifications/${v.body.id}/match`).set(bearer(m1.staff.token)).send({ decision: 'MATCH' }).expect(200);
    const q = await ctx.http.post('/v1/merchant/quotes').set(bearer(m1.staff.token)).send({ verificationId: v.body.id, grossMinor: 20000, rateBps: 10000, discountMinor: 20000, netMinor: 0 }).expect(201);
    expect(q.body).toMatchObject({ rateBps: 2000, discountMinor: 4000, netMinor: 16000 });
  });
});

describe('daily limit', () => {
  it('second use at the same store & day is rejected; another store works; second branch of same store rejected', async () => {
    const { m1, m2, user } = await world();
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    expect((await confirm(ctx, m1.staff, a.quote.id)).status).toBe(201);

    // same store, other branch → rejected at quote time
    const b = await approvedQuote(ctx, user, m1.staff, m1.branches[1].id);
    expect(b.quote).toBeNull();
    expect(b.quoteResponse.body.error.code).toBe('ALREADY_REDEEMED_TODAY');

    // different store, same day → allowed
    const c = await approvedQuote(ctx, user, m2.staff, m2.branches[0].id);
    expect((await confirm(ctx, m2.staff, c.quote.id)).status).toBe(201);

    expect(await ctx.prisma.redemption.count({ where: { status: 'CONFIRMED' } })).toBe(2);
  });

  it('two quotes prepared before either confirm: the second confirm is rejected by the DB constraint path', async () => {
    const { m1, user } = await world();
    const q1 = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    const q2 = await approvedQuote(ctx, user, m1.owner, m1.branches[1].id);
    expect((await confirm(ctx, m1.staff, q1.quote.id)).status).toBe(201);
    const r2 = await confirm(ctx, m1.owner, q2.quote.id);
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe('ALREADY_REDEEMED_TODAY');
  });

  it('local midnight resets eligibility (calendar day, not rolling 24h) and the device clock is irrelevant', async () => {
    // Build the world "in the past" so memberships and tokens are valid at the simulated time.
    ctx.clock.set(new Date('2026-01-15T12:00:00Z'));
    const { m1, user } = await world();
    // 23:58 local (winter, UTC+2)
    ctx.clock.set(new Date('2026-01-15T21:58:00Z'));
    await renew(ctx, user, m1.staff, m1.owner);
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    const r1 = await confirm(ctx, m1.staff, a.quote.id);
    expect(r1.status).toBe(201);
    expect(r1.body.businessDate).toBe('2026-01-15');

    // 23:59 local: still the same day → rejected, even if the client claims another date
    ctx.clock.set(new Date('2026-01-15T21:59:30Z'));
    await renew(ctx, user, m1.staff, m1.owner);
    const b = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    expect(b.quoteResponse.body.error.code).toBe('ALREADY_REDEEMED_TODAY');

    // 00:01 local next day (3 minutes later) → allowed
    ctx.clock.set(new Date('2026-01-15T22:01:00Z'));
    await renew(ctx, user, m1.staff, m1.owner);
    const c = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    const r2 = await ctx.http.post('/v1/merchant/redemptions').set(bearer(m1.staff.token)).set('Idempotency-Key', idemKey()).set('Date', 'Wed, 01 Jan 2020 00:00:00 GMT').send({ quoteId: c.quote.id });
    expect(r2.status).toBe(201);
    expect(r2.body.businessDate).toBe('2026-01-16');
  });

  it('DST: business date follows Asia/Hebron offsets in summer', async () => {
    ctx.clock.set(new Date('2026-07-15T12:00:00Z'));
    const { m1, user } = await world();
    // Summer (UTC+3): 20:59Z = 23:59 local on 2026-07-15; 21:00Z = 00:00 local on 2026-07-16
    ctx.clock.set(new Date('2026-07-15T20:59:00Z'));
    await renew(ctx, user, m1.staff, m1.owner);
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    const r1 = await confirm(ctx, m1.staff, a.quote.id);
    expect(r1.body.businessDate).toBe('2026-07-15');
    ctx.clock.set(new Date('2026-07-15T21:00:30Z'));
    await renew(ctx, user, m1.staff, m1.owner);
    const b = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    const r2 = await confirm(ctx, m1.staff, b.quote.id);
    expect(r2.status).toBe(201);
    expect(r2.body.businessDate).toBe('2026-07-16');
  });

  it('a session spanning midnight is re-evaluated at confirmation and stamped with the confirmation date', async () => {
    ctx.clock.set(new Date('2026-01-15T12:00:00Z'));
    const { m1, user } = await world();
    ctx.clock.set(new Date('2026-01-15T21:55:00Z')); // 23:55 local
    await renew(ctx, user, m1.staff, m1.owner);
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    ctx.clock.set(new Date('2026-01-15T22:02:00Z')); // 00:02 next day, quote still valid (10 min)
    await renew(ctx, user, m1.staff, m1.owner);
    const r = await confirm(ctx, m1.staff, a.quote.id);
    expect(r.status).toBe(201);
    expect(r.body.businessDate).toBe('2026-01-16');
  });
});

describe('concurrency & idempotency', () => {
  it('20 concurrent confirmations for the same entitlement produce exactly one redemption and no 500s', async () => {
    const { m1, user } = await world();
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    const results = await Promise.all(Array.from({ length: 20 }, () => confirm(ctx, m1.staff, a.quote.id)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    const codes = new Set(results.filter((r) => r.status === 409).map((r) => r.body.error.code));
    for (const c of codes) expect(['QUOTE_ALREADY_USED', 'ALREADY_REDEEMED_TODAY', 'REQUEST_IN_PROGRESS']).toContain(c);
    expect(await ctx.prisma.redemption.count()).toBe(1);
  });

  it('20 concurrent confirmations from different quotes/staff for the same user+store → one wins', async () => {
    const { m1, user } = await world();
    const quotes = [];
    // Two live verifications (one per branch; a new scan at the same branch cancels the previous one).
    for (let i = 0; i < 2; i++) quotes.push((await approvedQuote(ctx, user, i % 2 ? m1.owner : m1.staff, m1.branches[i].id)).quote);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => confirm(ctx, i % 2 ? m1.owner : m1.staff, quotes[i % 2].id)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.map((r) => `${r.status}:${r.body.error?.code ?? ''}`).filter((s) => !/^(201|409):/.test(s))).toEqual([]);
    expect(await ctx.prisma.redemption.count()).toBe(1);
  });

  it('same Idempotency-Key replays the original result; same key with different payload is rejected', async () => {
    const { m1, user } = await world();
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    const key = idemKey();
    const first = await confirm(ctx, m1.staff, a.quote.id, key);
    expect(first.status).toBe(201);
    // Simulated network loss after commit: client retries with the same key
    const replay = await confirm(ctx, m1.staff, a.quote.id, key);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    // same key, different quote
    const other = await ctx.prisma.discountQuote.create({ data: { ...(await ctx.prisma.discountQuote.findFirstOrThrow({ select: { verificationId: true, userId: true, storeId: true, branchId: true, staffUserId: true, offerId: true, offerVersion: true, rateBps: true, grossMinor: true, eligibleMinor: true, discountMinor: true, netMinor: true, termsSnapshot: true, fingerprint: true, expiresAt: true } })), termsSnapshot: {} } });
    const mismatch = await confirm(ctx, m1.staff, other.id, key);
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    // a different actor using the same key does not receive the first actor's result
    const owner = await confirm(ctx, m1.owner, a.quote.id, key);
    expect(owner.status).toBe(409);
    expect(owner.body.error.code).toBe('QUOTE_ALREADY_USED');
    expect(await ctx.prisma.redemption.count()).toBe(1);
  });

  it('concurrent identical retries with the same key produce one redemption and consistent replies', async () => {
    const { m1, user } = await world();
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    const key = idemKey();
    const rs = await Promise.all(Array.from({ length: 10 }, () => confirm(ctx, m1.staff, a.quote.id, key)));
    const ok = rs.filter((r) => r.status === 200 || r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of ok) expect(r.body.id).toBe(ok[0].body.id);
    expect(await ctx.prisma.redemption.count()).toBe(1);
  });

  it('missing Idempotency-Key is rejected', async () => {
    const { m1, user } = await world();
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    const r = await ctx.http.post('/v1/merchant/redemptions').set(bearer(m1.staff.token)).send({ quoteId: a.quote.id });
    expect(r.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});

describe('state changes between scan and confirm', () => {
  it('card suspended after approval blocks confirmation', async () => {
    const { admin, m1, user } = await world();
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    await ctx.http.post(`/v1/admin/users/${user.userId}/card`).set(bearer(admin.token)).send({ action: 'SUSPEND', reason: 'investigation' }).expect(201);
    const r = await confirm(ctx, m1.staff, a.quote.id);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(['CARD_SUSPENDED', 'VERIFICATION_EXPIRED']).toContain(r.body.error.code);
    expect(await ctx.prisma.redemption.count()).toBe(0);
  });

  it('subscription cancelled/expired between scan and confirm blocks confirmation', async () => {
    const { admin, m1, user } = await world();
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    const sub = await ctx.prisma.subscription.findFirstOrThrow({ where: { userId: user.userId } });
    await ctx.http.post(`/v1/admin/subscriptions/${sub.id}/cancel`).set(bearer(admin.token)).send({ reason: 'refund' }).expect(204);
    const r = await confirm(ctx, m1.staff, a.quote.id);
    expect(r.body.error.code).toBe('CARD_EXPIRED');
  });

  it('concurrent suspension and confirmation serialize: either the redemption precedes the suspension or it is rejected', async () => {
    const { admin, m1, user } = await world();
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    const [c, s] = await Promise.all([
      confirm(ctx, m1.staff, a.quote.id),
      ctx.http.post(`/v1/admin/users/${user.userId}/card`).set(bearer(admin.token)).send({ action: 'SUSPEND', reason: 'race' }),
    ]);
    expect(s.status).toBe(201);
    const redemption = await ctx.prisma.redemption.findFirst();
    const card = await ctx.prisma.card.findFirstOrThrow({ where: { userId: user.userId, isCurrent: true } });
    expect(card.status).toBe('SUSPENDED');
    if (c.status === 201) {
      // Redemption committed before the suspension took the card lock.
      expect(redemption!.confirmedAt.getTime()).toBeLessThanOrEqual(card.updatedAt.getTime());
    } else {
      expect(redemption).toBeNull();
    }
  });

  it('offer change after quote invalidates it (QUOTE_CHANGED); re-quote + approval required; old records unchanged', async () => {
    const { admin, m1, m2, user } = await world();
    // earlier redemption at store 2 is a historical snapshot
    const past = await approvedQuote(ctx, user, m2.staff, m2.branches[0].id);
    await confirm(ctx, m2.staff, past.quote.id);
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    await ctx.http.post(`/v1/admin/stores/${m1.store.id}/offers`).set(bearer(admin.token)).send({ rateBps: 3000, reason: 'promo' }).expect(201);
    const r = await confirm(ctx, m1.staff, a.quote.id);
    expect(r.body.error.code).toBe('QUOTE_CHANGED');
    // re-quote uses the new rate and needs a fresh approval
    const q = await ctx.http.post('/v1/merchant/quotes').set(bearer(m1.staff.token)).send({ verificationId: a.verificationId, grossMinor: 20000 }).expect(201);
    expect(q.body.rateBps).toBe(3000);
    expect((await confirm(ctx, m1.staff, q.body.id)).body.error.code).toBe('APPROVAL_REQUIRED');
    await ctx.http.post(`/v1/me/approvals/${q.body.id}/approve`).set(bearer(user.token)).send({ fingerprint: q.body.fingerprint }).expect(200);
    const ok = await confirm(ctx, m1.staff, q.body.id);
    expect(ok.status).toBe(201);
    expect(ok.body.discountMinor).toBe(6000);
    // Changing store 2's offer does not modify its past redemption
    await ctx.http.post(`/v1/admin/stores/${m2.store.id}/offers`).set(bearer(admin.token)).send({ rateBps: 5000, reason: 'change' }).expect(201);
    const old = await ctx.prisma.redemption.findFirstOrThrow({ where: { storeId: m2.store.id } });
    expect(old.rateBps).toBe(2000);
    expect(old.discountMinor).toBe(4000);
    // and the DB refuses to rewrite it
    await expect(ctx.prisma.redemption.update({ where: { id: old.id }, data: { discountMinor: 1 } })).rejects.toThrow();
  });

  it('a new quote for the same verification supersedes the old approval', async () => {
    const { m1, user } = await world();
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    const q2 = await ctx.http.post('/v1/merchant/quotes').set(bearer(m1.staff.token)).send({ verificationId: a.verificationId, grossMinor: 50000 }).expect(201);
    expect((await confirm(ctx, m1.staff, a.quote.id)).body.error.code).toBe('QUOTE_CHANGED');
    expect((await confirm(ctx, m1.staff, q2.body.id)).body.error.code).toBe('APPROVAL_REQUIRED');
  });

  it('approval of a different amount (stale fingerprint) is rejected', async () => {
    const { m1, user } = await world();
    const payload = await qrFor(ctx, user);
    const v = await ctx.http.post('/v1/merchant/verifications').set(bearer(m1.staff.token)).send({ branchId: m1.branches[0].id, qrPayload: payload }).expect(201);
    await ctx.http.post(`/v1/merchant/verifications/${v.body.id}/match`).set(bearer(m1.staff.token)).send({ decision: 'MATCH' });
    const q1 = await ctx.http.post('/v1/merchant/quotes').set(bearer(m1.staff.token)).send({ verificationId: v.body.id, grossMinor: 10000 }).expect(201);
    const q2 = await ctx.http.post('/v1/merchant/quotes').set(bearer(m1.staff.token)).send({ verificationId: v.body.id, grossMinor: 90000 }).expect(201);
    // user approves q2 with q1's fingerprint (what they saw) → mismatch
    const r = await ctx.http.post(`/v1/me/approvals/${q2.body.id}/approve`).set(bearer(user.token)).send({ fingerprint: q1.body.fingerprint });
    expect(r.body.error.code).toBe('APPROVAL_MISMATCH');
    // q1 is superseded and cannot be approved
    const r1 = await ctx.http.post(`/v1/me/approvals/${q1.body.id}/approve`).set(bearer(user.token)).send({ fingerprint: q1.body.fingerprint });
    expect(r1.body.error.code).toBe('QUOTE_CHANGED');
  });

  it('customer rejection blocks confirmation', async () => {
    const { m1, user } = await world();
    const payload = await qrFor(ctx, user);
    const v = await ctx.http.post('/v1/merchant/verifications').set(bearer(m1.staff.token)).send({ branchId: m1.branches[0].id, qrPayload: payload }).expect(201);
    await ctx.http.post(`/v1/merchant/verifications/${v.body.id}/match`).set(bearer(m1.staff.token)).send({ decision: 'MATCH' });
    const q = await ctx.http.post('/v1/merchant/quotes').set(bearer(m1.staff.token)).send({ verificationId: v.body.id, grossMinor: 10000 }).expect(201);
    const pending = await ctx.http.get('/v1/me/approvals/pending').set(bearer(user.token)).expect(200);
    expect(pending.body[0]).toMatchObject({ id: q.body.id, netMinor: 8000, store: { id: m1.store.id } });
    await ctx.http.post(`/v1/me/approvals/${q.body.id}/reject`).set(bearer(user.token)).send({ fingerprint: q.body.fingerprint }).expect(200);
    expect((await confirm(ctx, m1.staff, q.body.id)).body.error.code).toBe('APPROVAL_REJECTED');
  });
});

describe('QR & verification security', () => {
  it('expired, reused and forged QR tokens are rejected', async () => {
    const { m1, user } = await world();
    const payload = await qrFor(ctx, user);
    await ctx.prisma.qrToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await ctx.http.post('/v1/merchant/verifications').set(bearer(m1.staff.token)).send({ branchId: m1.branches[0].id, qrPayload: payload });
    expect(expired.body.error.code).toBe('QR_EXPIRED');
    ctx.clock.set(null);

    const p2 = await qrFor(ctx, user);
    await ctx.http.post('/v1/merchant/verifications').set(bearer(m1.staff.token)).send({ branchId: m1.branches[0].id, qrPayload: p2 }).expect(201);
    const reused = await ctx.http.post('/v1/merchant/verifications').set(bearer(m1.staff.token)).send({ branchId: m1.branches[0].id, qrPayload: p2 });
    expect(reused.body.error.code).toBe('QR_INVALID');

    const forged = await ctx.http.post('/v1/merchant/verifications').set(bearer(m1.staff.token)).send({ branchId: m1.branches[0].id, qrPayload: 'BTQ1.' + 'A'.repeat(43) });
    expect(forged.body.error.code).toBe('QR_INVALID');
    const garbage = await ctx.http.post('/v1/merchant/verifications').set(bearer(m1.staff.token)).send({ branchId: m1.branches[0].id, qrPayload: 'hello' });
    expect(garbage.body.error.code).toBe('QR_INVALID');
  });

  it('issuing a new QR revokes the previous one; logout revokes live QR tokens', async () => {
    const { m1, user } = await world();
    const p1 = await qrFor(ctx, user);
    await qrFor(ctx, user);
    const r = await ctx.http.post('/v1/merchant/verifications').set(bearer(m1.staff.token)).send({ branchId: m1.branches[0].id, qrPayload: p1 });
    expect(r.body.error.code).toBe('QR_INVALID');
    const p3 = await qrFor(ctx, user);
    await ctx.http.post('/v1/auth/logout').set(bearer(user.token)).expect(204);
    const r3 = await ctx.http.post('/v1/merchant/verifications').set(bearer(m1.staff.token)).send({ branchId: m1.branches[0].id, qrPayload: p3 });
    expect(r3.body.error.code).toBe('QR_INVALID');
  });

  it('QR token is never stored in plaintext', async () => {
    const { user } = await world();
    const payload = await qrFor(ctx, user);
    const token = payload.slice(5);
    const rows = await ctx.prisma.$queryRaw<Array<{ c: bigint }>>`SELECT count(*) AS c FROM qr_tokens WHERE token_hash = ${token}`;
    expect(Number(rows[0].c)).toBe(0);
  });

  it('QR is not issued for inactive memberships', async () => {
    const { admin, user } = await world();
    await ctx.http.post(`/v1/admin/users/${user.userId}/card`).set(bearer(admin.token)).send({ action: 'SUSPEND', reason: 'x investigation' }).expect(201);
    const r = await ctx.http.post('/v1/me/card/qr-token').set(bearer(user.token));
    expect(r.body.error.code).toBe('CARD_SUSPENDED');
    const fresh = await registerUser(ctx);
    const r2 = await ctx.http.post('/v1/me/card/qr-token').set(bearer(fresh.token));
    expect(r2.body.error.code).toBe('CARD_PENDING');
    const card = await ctx.http.get('/v1/me/card').set(bearer(fresh.token)).expect(200);
    expect(card.body).toMatchObject({ canShowQr: false, membership: { state: 'PENDING_ACTIVATION' } });
    expect(card.body.card.serialNumber).toMatch(/^BT-/);
  });

  it('staff of another merchant cannot use a verification, see the photo, quote or confirm', async () => {
    const { m1, m2, user } = await world();
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    const v = await ctx.http.get(`/v1/merchant/verifications/${a.verificationId}`).set(bearer(m2.staff.token));
    expect(v.body.error.code).toBe('BRANCH_NOT_ASSIGNED');
    const photo = await ctx.http.get(`/v1/merchant/verifications/${a.verificationId}/photo`).set(bearer(m2.staff.token));
    expect(photo.status).toBe(403);
    const q = await ctx.http.post('/v1/merchant/quotes').set(bearer(m2.staff.token)).send({ verificationId: a.verificationId, grossMinor: 100 });
    expect(q.body.error.code).toBe('BRANCH_NOT_ASSIGNED');
    const c = await confirm(ctx, m2.staff, a.quote.id);
    expect(c.body.error.code).toBe('BRANCH_NOT_ASSIGNED');
    // and cannot scan into a branch it is not assigned to
    const payload = await qrFor(ctx, user);
    const s = await ctx.http.post('/v1/merchant/verifications').set(bearer(m2.staff.token)).send({ branchId: m1.branches[0].id, qrPayload: payload });
    expect(s.body.error.code).toBe('BRANCH_NOT_ASSIGNED');
    expect(await ctx.prisma.redemption.count()).toBe(0);
  });

  it('staff assigned to branch 1 only cannot operate branch 2', async () => {
    const { m1, user } = await world();
    await ctx.prisma.membershipBranch.deleteMany({ where: { membershipId: m1.staffMembershipId, branchId: m1.branches[1].id } });
    const payload = await qrFor(ctx, user);
    const r = await ctx.http.post('/v1/merchant/verifications').set(bearer(m1.staff.token)).send({ branchId: m1.branches[1].id, qrPayload: payload });
    expect(r.body.error.code).toBe('BRANCH_NOT_ASSIGNED');
  });

  it('photo is visible to the verifying staff during the live session only', async () => {
    const { m1, user } = await world();
    const payload = await qrFor(ctx, user);
    const v = await ctx.http.post('/v1/merchant/verifications').set(bearer(m1.staff.token)).send({ branchId: m1.branches[0].id, qrPayload: payload }).expect(201);
    expect(v.body.holder).toMatchObject({ fullName: 'Member One', photoAvailable: true });
    const photo = await ctx.http.get(`/v1/merchant/verifications/${v.body.id}/photo`).set(bearer(m1.staff.token)).expect(200);
    expect(photo.headers['content-type']).toBe('image/jpeg');
    expect(photo.headers['cache-control']).toContain('no-store');
    // EXIF stripped by re-encoding
    expect(photo.body.toString('latin1')).not.toContain('secret-exif-marker');
    await ctx.prisma.verificationSession.update({ where: { id: v.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const late = await ctx.http.get(`/v1/merchant/verifications/${v.body.id}/photo`).set(bearer(m1.staff.token));
    expect(late.body.error.code).toBe('VERIFICATION_EXPIRED');
  });

  it('mismatch decision prevents quoting', async () => {
    const { m1, user } = await world();
    const payload = await qrFor(ctx, user);
    const v = await ctx.http.post('/v1/merchant/verifications').set(bearer(m1.staff.token)).send({ branchId: m1.branches[0].id, qrPayload: payload }).expect(201);
    await ctx.http.post(`/v1/merchant/verifications/${v.body.id}/match`).set(bearer(m1.staff.token)).send({ decision: 'MISMATCH' }).expect(200);
    const q = await ctx.http.post('/v1/merchant/quotes').set(bearer(m1.staff.token)).send({ verificationId: v.body.id, grossMinor: 100 });
    expect(q.body.error.code).toBe('VERIFICATION_REJECTED');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'verification.mismatch' } })).toBe(1);
  });

  it('manual serial entry requires the card holder to accept in-app before any personal data is shown', async () => {
    const { m1, user } = await world();
    const card = await ctx.http.get('/v1/me/card').set(bearer(user.token)).expect(200);
    const serial = card.body.card.serialNumber.replace(/-/g, '').toLowerCase(); // tolerant input
    const v = await ctx.http.post('/v1/merchant/verifications').set(bearer(m1.staff.token)).send({ branchId: m1.branches[0].id, serialNumber: serial }).expect(201);
    expect(v.body.status).toBe('AWAITING_USER');
    expect(v.body.holder).toBeNull();
    const photo = await ctx.http.get(`/v1/merchant/verifications/${v.body.id}/photo`).set(bearer(m1.staff.token));
    expect(photo.status).not.toBe(200);
    const q = await ctx.http.post('/v1/merchant/quotes').set(bearer(m1.staff.token)).send({ verificationId: v.body.id, grossMinor: 100 });
    expect(q.body.error.code).toBe('AWAITING_USER_CONFIRMATION');
    const match = await ctx.http.post(`/v1/merchant/verifications/${v.body.id}/match`).set(bearer(m1.staff.token)).send({ decision: 'MATCH' });
    expect(match.body.error.code).toBe('AWAITING_USER_CONFIRMATION');

    const reqs = await ctx.http.get('/v1/me/verification-requests').set(bearer(user.token)).expect(200);
    expect(reqs.body[0]).toMatchObject({ id: v.body.id, store: { id: m1.store.id } });
    await ctx.http.post(`/v1/me/verification-requests/${v.body.id}/accept`).set(bearer(user.token)).expect(200);
    const after = await ctx.http.get(`/v1/merchant/verifications/${v.body.id}`).set(bearer(m1.staff.token)).expect(200);
    expect(after.body.status).toBe('PENDING_MATCH');
    expect(after.body.holder.fullName).toBe('Member One');
    // another user cannot accept someone else's request
    const other = await registerUser(ctx);
    const r = await ctx.http.post(`/v1/me/verification-requests/${v.body.id}/accept`).set(bearer(other.token));
    expect(r.status).toBe(404);
  });

  it('manual lookup is rate limited and unknown serials reveal nothing', async () => {
    const { m1 } = await world();
    const codes: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await ctx.http.post('/v1/merchant/verifications').set(bearer(m1.staff.token)).send({ branchId: m1.branches[0].id, serialNumber: `BT-0000-0000-00${String(i).padStart(2, '0')}` });
      codes.push(r.body.error.code);
    }
    expect(codes.slice(0, 10).every((c) => c === 'CARD_NOT_FOUND')).toBe(true);
    expect(codes.slice(10)).toEqual(['RATE_LIMITED', 'RATE_LIMITED']);
  });

  it('a plain user (no merchant membership) cannot use merchant endpoints', async () => {
    const { m1, user } = await world();
    const r = await ctx.http.post('/v1/merchant/verifications').set(bearer(user.token)).send({ branchId: m1.branches[0].id, qrPayload: 'BTQ1.' + 'a'.repeat(43) });
    expect(r.body.error.code).toBe('BRANCH_NOT_ASSIGNED');
    const d = await ctx.http.get('/v1/merchant/dashboard').set(bearer(user.token));
    expect(d.status).toBe(403);
  });
});

describe('no consumption without confirmation', () => {
  it('scan + quote + approval + abandon does not consume the entitlement', async () => {
    const { m1, user } = await world();
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    await ctx.http.post(`/v1/merchant/verifications/${a.verificationId}/cancel`).set(bearer(m1.staff.token)).expect(204);
    const home = await ctx.http.get('/v1/me/home').set(bearer(user.token)).expect(200);
    expect(home.body.stats.todayRedemptions).toBe(0);
    expect(home.body.availableToday.map((s: { id: string }) => s.id)).toContain(m1.store.id);
    const b = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    expect((await confirm(ctx, m1.staff, b.quote.id)).status).toBe(201);
  });

  it('expired quote cannot be confirmed', async () => {
    const { m1, user } = await world();
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    await ctx.prisma.discountQuote.update({ where: { id: a.quote.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const r = await confirm(ctx, m1.staff, a.quote.id);
    expect(['QUOTE_EXPIRED', 'VERIFICATION_EXPIRED']).toContain(r.body.error.code);
  });
});

describe('void', () => {
  it('void keeps history, excludes from totals, and restores today\'s entitlement; voiding yesterday does not affect today', async () => {
    ctx.clock.set(new Date('2026-01-15T09:00:00Z'));
    const { admin, m1, user } = await world();
    ctx.clock.set(new Date('2026-01-15T10:00:00Z'));
    await renew(ctx, user, m1.staff, m1.owner);
    const y = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    const yesterday = await confirm(ctx, m1.staff, y.quote.id);
    ctx.clock.set(new Date('2026-01-16T10:00:00Z'));
    await renew(ctx, user, m1.staff, m1.owner);
    admin.token = (await ctx.auth.createSession(admin.userId, { platform: 'web' }, ctx.clock.now())).accessToken;
    const t = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    const today = await confirm(ctx, m1.staff, t.quote.id);
    expect(today.status).toBe(201);

    // voiding yesterday's does not reopen today
    await ctx.http.post(`/v1/admin/redemptions/${yesterday.body.id}/void`).set(bearer(admin.token)).send({ reason: 'cashier mistake' }).expect(200);
    const again = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    expect(again.quoteResponse.body.error.code).toBe('ALREADY_REDEEMED_TODAY');

    // voiding today's reopens today
    const v = await ctx.http.post(`/v1/admin/redemptions/${today.body.id}/void`).set(bearer(admin.token)).send({ reason: 'wrong amount' }).expect(200);
    expect(v.body).toMatchObject({ status: 'VOIDED', voidReason: 'wrong amount' });
    const dup = await ctx.http.post(`/v1/admin/redemptions/${today.body.id}/void`).set(bearer(admin.token)).send({ reason: 'again' });
    expect(dup.body.error.code).toBe('ALREADY_VOIDED');
    const c = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    expect((await confirm(ctx, m1.staff, c.quote.id)).status).toBe(201);

    // history retained; voided not counted as savings
    const usage = await ctx.http.get('/v1/me/usage').set(bearer(user.token)).expect(200);
    expect(usage.body.items).toHaveLength(3);
    expect(usage.body.items.filter((i: { status: string }) => i.status === 'VOIDED')).toHaveLength(2);
    const home = await ctx.http.get('/v1/me/home').set(bearer(user.token)).expect(200);
    expect(home.body.stats.totalRedemptions).toBe(1);
    expect(home.body.stats.totalSavingsMinor).toBe(4000);
    const events = await ctx.prisma.redemptionEvent.findMany({ where: { redemptionId: today.body.id } });
    expect(events.map((e) => e.type).sort()).toEqual(['CONFIRMED', 'VOIDED']);
    await expect(ctx.prisma.redemptionEvent.deleteMany({})).rejects.toThrow();
    await expect(ctx.prisma.auditLog.deleteMany({})).rejects.toThrow();
    const audit = await ctx.prisma.auditLog.findMany({ where: { action: 'redemption.void' } });
    expect(audit).toHaveLength(2);
    // voided cannot be restored
    await expect(ctx.prisma.redemption.update({ where: { id: today.body.id }, data: { status: 'CONFIRMED', voidedAt: null, voidReason: null, voidedById: null } })).rejects.toThrow();
  });

  it('only admins with REDEMPTIONS_VOID can void; merchant owner and staff cannot', async () => {
    const { m1, user } = await world();
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    const r = await confirm(ctx, m1.staff, a.quote.id);
    for (const t of [m1.staff.token, m1.owner.token, user.token]) {
      const x = await ctx.http.post(`/v1/admin/redemptions/${r.body.id}/void`).set(bearer(t)).send({ reason: 'nope' });
      expect(x.status).toBe(403);
    }
    const viewer = await createAdmin(ctx, ['REDEMPTIONS_VIEW']);
    const y = await ctx.http.post(`/v1/admin/redemptions/${r.body.id}/void`).set(bearer(viewer.token)).send({ reason: 'nope' });
    expect(y.body.error.code).toBe('FORBIDDEN');
  });
});

describe('renewal, replacement and expiry do not reset today', () => {
  it('card replacement and subscription renewal keep today\'s consumption', async () => {
    const { admin, m1, user } = await world();
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    expect((await confirm(ctx, m1.staff, a.quote.id)).status).toBe(201);
    const oldCard = await ctx.prisma.card.findFirstOrThrow({ where: { userId: user.userId, isCurrent: true } });
    const rep = await ctx.http.post(`/v1/admin/users/${user.userId}/card`).set(bearer(admin.token)).send({ action: 'REPLACE', reason: 'lost phone' }).expect(201);
    expect(rep.body.serialNumber).not.toBe(oldCard.serialNumber);
    const plan = await planFixture(ctx, 365);
    await ctx.http.post(`/v1/admin/users/${user.userId}/subscriptions`).set(bearer(admin.token)).send({ planId: plan.id, reason: 'renewal' }).expect(201);
    const b = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    expect(b.quoteResponse.body.error.code).toBe('ALREADY_REDEEMED_TODAY');
  });

  it('expired subscription blocks; renewal the same day still does not restore a consumed use', async () => {
    const { admin, m1, user } = await world();
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    await confirm(ctx, m1.staff, a.quote.id);
    const sub = await ctx.prisma.subscription.findFirstOrThrow({ where: { userId: user.userId } });
    await ctx.prisma.subscription.update({ where: { id: sub.id }, data: { endsAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 86400_000) } });
    const card = await ctx.http.get('/v1/me/card').set(bearer(user.token)).expect(200);
    expect(card.body.membership.state).toBe('EXPIRED');
    expect(card.body.canShowQr).toBe(false);
    const plan = await planFixture(ctx, 30);
    await ctx.http.post(`/v1/admin/users/${user.userId}/subscriptions`).set(bearer(admin.token)).send({ planId: plan.id, reason: 'renewed' }).expect(201);
    const b = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    expect(b.quoteResponse.body.error.code).toBe('ALREADY_REDEEMED_TODAY');
  });
});

describe('outbox & notifications', () => {
  it('push failure never undoes a committed redemption; notifications are deduplicated', async () => {
    const { m1, user } = await world();
    await ctx.http.post('/v1/me/push-tokens').set(bearer(user.token)).send({ token: 'ExponentPushToken[test-token-123]', platform: 'ios' }).expect(204);
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id);
    const r = await confirm(ctx, m1.staff, a.quote.id);
    expect(r.status).toBe(201);
    const provider = ctx.app.get(require('../src/notifications/push.provider').PushProvider);
    const spy = jest.spyOn(provider, 'send').mockRejectedValue(new Error('provider down'));
    await ctx.outbox.processBatch();
    spy.mockRestore();
    expect(await ctx.prisma.redemption.count({ where: { status: 'CONFIRMED' } })).toBe(1);
    // in-app notification exists regardless of push; processing again creates no duplicates
    await ctx.prisma.outboxEvent.updateMany({ data: { processedAt: null, availableAt: new Date(0) } });
    await ctx.outbox.processBatch();
    const notes = await ctx.http.get('/v1/me/notifications').set(bearer(user.token)).set('Accept-Language', 'en').expect(200);
    const confirmed = notes.body.items.filter((n: { type: string }) => n.type === 'REDEMPTION_CONFIRMED');
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].body).toContain('₪40.00');
    // Delivery outcome recorded honestly (dev provider → SIMULATED, never SENT)
    const deliveries = await ctx.prisma.notificationDelivery.findMany();
    expect(deliveries.every((d) => d.status !== 'SENT')).toBe(true);
  });
});

describe('merchant reporting & isolation', () => {
  it('dashboard aggregates confirmed only, per scope; staff cannot see another merchant\'s data', async () => {
    const { admin, m1, m2, user } = await world();
    const user2 = await registerUser(ctx, { name: 'Member Two' });
    await activateMember(ctx, user2, admin);
    const a = await approvedQuote(ctx, user, m1.staff, m1.branches[0].id, 20000);
    const r1 = await confirm(ctx, m1.staff, a.quote.id);
    const b = await approvedQuote(ctx, user2, m1.staff, m1.branches[1].id, 10000);
    await confirm(ctx, m1.staff, b.quote.id);
    const c = await approvedQuote(ctx, user, m2.staff, m2.branches[0].id, 5000);
    await confirm(ctx, m2.staff, c.quote.id);
    await ctx.http.post(`/v1/admin/redemptions/${r1.body.id}/void`).set(bearer(admin.token)).send({ reason: 'test void' }).expect(200);

    const d = await ctx.http.get('/v1/merchant/dashboard?period=today').set(bearer(m1.owner.token)).expect(200);
    expect(d.body).toMatchObject({ redemptions: 1, distinctCustomers: 1, grossMinor: 10000, discountMinor: 2000, netMinor: 8000 });

    const list = await ctx.http.get('/v1/merchant/redemptions').set(bearer(m1.staff.token)).expect(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items.every((i: { store: { id: string } }) => i.store.id === m1.store.id)).toBe(true);
    // customer name is first-name only for merchants
    expect(list.body.items.map((i: { customerName: string }) => i.customerName).sort()).toEqual(['Member', 'Member']);

    const cross = await ctx.http.get(`/v1/merchant/redemptions?storeId=${m2.store.id}`).set(bearer(m1.staff.token));
    expect(cross.status).toBe(403);
    const m2Redemption = await ctx.prisma.redemption.findFirstOrThrow({ where: { storeId: m2.store.id } });
    const single = await ctx.http.get(`/v1/merchant/redemptions/${m2Redemption.id}`).set(bearer(m1.owner.token));
    expect(single.status).toBe(404);
  });

  it('staff cannot change offers, access admin, or grant roles; owner can manage own staff only', async () => {
    const { m1, m2 } = await world();
    const r1 = await ctx.http.post(`/v1/admin/stores/${m1.store.id}/offers`).set(bearer(m1.staff.token)).send({ rateBps: 9000, reason: 'hack' });
    expect(r1.status).toBe(403);
    const r2 = await ctx.http.post('/v1/admin/invitations').set(bearer(m1.owner.token)).send({ email: 'x@example.test', kind: 'ADMIN', permissions: ['USERS_MANAGE'] });
    expect(r2.status).toBe(403);
    const r3 = await ctx.http.get(`/v1/merchant/merchants/${m1.merchant.id}/staff`).set(bearer(m1.staff.token));
    expect(r3.body.error.code).toBe('FORBIDDEN');
    const r4 = await ctx.http.get(`/v1/merchant/merchants/${m2.merchant.id}/staff`).set(bearer(m1.owner.token));
    expect(r4.body.error.code).toBe('FORBIDDEN');
    // owner cannot assign branches of another merchant
    const r5 = await ctx.http.patch(`/v1/merchant/merchants/${m1.merchant.id}/staff/${m1.staffMembershipId}/branches`).set(bearer(m1.owner.token)).send({ branchIds: [m2.branches[0].id] });
    expect(r5.body.error.code).toBe('FORBIDDEN');
    // owner invites staff to own branch; invitation creates STAFF only
    const inv = await ctx.http.post(`/v1/merchant/merchants/${m1.merchant.id}/staff/invitations`).set(bearer(m1.owner.token)).send({ email: 'newstaff@example.test', storeId: m1.store.id, branchIds: [m1.branches[0].id] }).expect(201);
    expect(inv.body.invitationId).toBeDefined();
    const token = /token=([^&\s]+)/.exec(ctx.mail.last('newstaff@example.test')!.text)![1];
    const acc = await ctx.http.post('/v1/auth/invitations/accept').send({ token: decodeURIComponent(token), fullName: 'New Staff', password: 'Str0ngPassw0rd!' }).expect(200);
    const ws = await ctx.http.get('/v1/me/workspaces').set(bearer(acc.body.accessToken)).expect(200);
    expect(ws.body.merchant[0]).toMatchObject({ merchantId: m1.merchant.id, role: 'STAFF' });
    expect(ws.body.merchant[0].stores[0].branches.map((b: { id: string }) => b.id)).toEqual([m1.branches[0].id]);
    expect(ws.body.admin).toBeNull();
    // invitation cannot be reused
    const again = await ctx.http.post('/v1/auth/invitations/accept').send({ token: decodeURIComponent(token), fullName: 'XY', password: 'Str0ngPassw0rd!' });
    expect(again.body.error.code).toBe('TOKEN_INVALID');
  });

  it('deactivated staff immediately loses access', async () => {
    const { m1, user } = await world();
    await ctx.http.patch(`/v1/merchant/merchants/${m1.merchant.id}/staff/${m1.staffMembershipId}/active`).set(bearer(m1.owner.token)).send({ active: false }).expect(204);
    const payload = await qrFor(ctx, user);
    const r = await ctx.http.post('/v1/merchant/verifications').set(bearer(m1.staff.token)).send({ branchId: m1.branches[0].id, qrPayload: payload });
    expect(r.body.error.code).toBe('BRANCH_NOT_ASSIGNED');
  });

  it('suspended store is unavailable for new verifications and shown distinctly in the directory', async () => {
    const { admin, m1, user } = await world();
    await ctx.http.post(`/v1/admin/stores/${m1.store.id}/status`).set(bearer(admin.token)).send({ status: 'SUSPENDED', reason: 'contract paused' }).expect(204);
    const payload = await qrFor(ctx, user);
    const r = await ctx.http.post('/v1/merchant/verifications').set(bearer(m1.staff.token)).send({ branchId: m1.branches[0].id, qrPayload: payload });
    expect(r.body.error.code).toBe('STORE_UNAVAILABLE');
    const d = await ctx.http.get(`/v1/stores/${m1.store.id}`).set(bearer(user.token)).expect(200);
    expect(d.body.availability).toBe('STORE_SUSPENDED');
    const list = await ctx.http.get('/v1/stores').set(bearer(user.token)).expect(200);
    expect(list.body.items.map((s: { id: string }) => s.id)).not.toContain(m1.store.id);
  });
});

