import { writeFileSync } from 'node:fs';
import { activateMember, bearer, confirm, createAdmin, createTestApp, merchantFixture, qrFor, registerUser, resetDb, type TestCtx } from './helpers';

/**
 * Latency measurement of the cashier path (in-process HTTP, local PostgreSQL). Budget: p95 < 300 ms per step on a
 * developer-class machine; the assertion is deliberately loose (1.5 s) to avoid CI flakiness — the measured numbers
 * are written to test-results/perf.json and copied into docs/test-report.md.
 */
let ctx: TestCtx;
beforeAll(async () => {
  ctx = await createTestApp();
  await resetDb(ctx.prisma);
});
afterAll(async () => {
  await ctx.app.close();
});

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

it('cashier path latency', async () => {
  const admin = await createAdmin(ctx);
  const m = await merchantFixture(ctx);
  // background data volume so indexes matter
  const N = 30;
  const timings: Record<string, number[]> = { verification: [], quote: [], approve: [], confirm: [] };
  for (let i = 0; i < N; i++) {
    const u = await registerUser(ctx);
    await activateMember(ctx, u, admin);
    const payload = await qrFor(ctx, u);
    let t = performance.now();
    const v = await ctx.http.post('/v1/merchant/verifications').set(bearer(m.staff.token)).send({ branchId: m.branches[0].id, qrPayload: payload });
    timings.verification.push(performance.now() - t);
    await ctx.http.post(`/v1/merchant/verifications/${v.body.id}/match`).set(bearer(m.staff.token)).send({ decision: 'MATCH' });
    t = performance.now();
    const q = await ctx.http.post('/v1/merchant/quotes').set(bearer(m.staff.token)).send({ verificationId: v.body.id, grossMinor: 12345 });
    timings.quote.push(performance.now() - t);
    t = performance.now();
    await ctx.http.post(`/v1/me/approvals/${q.body.id}/approve`).set(bearer(u.token)).send({ fingerprint: q.body.fingerprint });
    timings.approve.push(performance.now() - t);
    t = performance.now();
    const c = await confirm(ctx, m.staff, q.body.id);
    timings.confirm.push(performance.now() - t);
    expect(c.status).toBe(201);
    ctx.rateLimit.clearMemory();
  }
  const summary = Object.fromEntries(Object.entries(timings).map(([k, xs]) => [k, { n: xs.length, p50: Math.round(pct(xs, 50)), p95: Math.round(pct(xs, 95)), max: Math.round(Math.max(...xs)) }]));
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary));
  try {
    require('node:fs').mkdirSync(__dirname + '/../test-results', { recursive: true });
    writeFileSync(__dirname + '/../test-results/perf.json', JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version, summary }, null, 2));
  } catch {
    /* ignore */
  }
  for (const k of Object.keys(summary)) expect(summary[k].p95).toBeLessThan(1500);
});
