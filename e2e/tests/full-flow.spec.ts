import { expect, test, type APIRequestContext } from '@playwright/test';
import { authenticator } from 'otplib';
import { readFileSync } from 'node:fs';

/**
 * Registration → admin activation (browser) → scan → quote → customer approval → merchant confirmation →
 * duplicate blocked → customer history → admin dashboard/transactions (browser) → void (browser).
 * "Mobile" steps call the same REST endpoints the Expo app uses.
 */
const API = 'http://localhost:4100';
const PHOTO = readFileSync(require.resolve('./fixtures/face.jpg'));

async function mailToken(to: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`http://localhost:2526/messages?to=${encodeURIComponent(to)}`);
    const msgs = (await r.json()) as Array<{ raw: string }>;
    const raw = msgs.at(-1)?.raw.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
    const m = raw && /token=([A-Za-z0-9_%-]+)/.exec(raw);
    if (m) return decodeURIComponent(m[1]);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no mail for ${to}`);
}

async function json<T>(req: APIRequestContext, method: 'get' | 'post', path: string, token?: string, data?: unknown, headers: Record<string, string> = {}) {
  const r = await req[method](`${API}${path}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, data });
  return { status: r.status(), body: (await r.json().catch(() => null)) as T };
}

test('full discount journey across member, merchant and admin', async ({ page, request }) => {
  const email = `e2e-${Date.now()}@example.test`;
  const password = 'E2eStr0ngPass!';

  // 1. Member registers and verifies email (real SMTP delivery to the sink)
  expect((await json(request, 'post', '/v1/auth/register', undefined, { email, password, fullName: 'E2E Member', locale: 'ar', acceptTerms: true })).status).toBe(202);
  expect((await json(request, 'post', '/v1/auth/verify-email', undefined, { token: await mailToken(email) })).status).toBe(200);
  const login = await json<{ accessToken: string }>(request, 'post', '/v1/auth/login', undefined, { email, password, platform: 'ios' });
  const member = login.body.accessToken;
  const up = await request.post(`${API}/v1/me/photo`, { headers: { Authorization: `Bearer ${member}` }, multipart: { photo: { name: 'me.jpg', mimeType: 'image/jpeg', buffer: PHOTO } } });
  expect(up.status()).toBe(201);
  const pending = await json<{ membership: { state: string }; canShowQr: boolean }>(request, 'get', '/v1/me/card', member);
  expect(pending.body.canShowQr).toBe(false);

  // 2. Admin signs in with TOTP enrollment (browser)
  await page.goto('/login');
  await page.getByLabel(/البريد الإلكتروني|Email/).fill('admin@bitaqati.test');
  await page.getByLabel(/كلمة المرور|Password/).fill('DevAdmin2026!pass');
  await page.getByRole('button', { name: /متابعة|Continue/ }).click();
  const secret = (await page.locator('p.mono').first().textContent())!.trim();
  await page.getByLabel(/رمز|code/i).fill(authenticator.generate(secret));
  await page.getByRole('button', { name: /تسجيل الدخول|Sign in/ }).click();
  await expect(page.getByText(/رموز الاسترداد|Recovery codes/)).toBeVisible();
  await page.getByRole('button', { name: /متابعة|Continue/ }).click();
  await expect(page.getByRole('heading', { name: /الرئيسية|Dashboard/ })).toBeVisible();

  // 3. Admin approves the photo and grants the membership (browser)
  await page.goto('/users');
  await page.getByLabel(/بحث|Search/).first().fill(email);
  await page.getByRole('button', { name: /بحث|Search/ }).click();
  await page.getByRole('link', { name: 'E2E Member' }).click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved (shown to merchants)')).toBeVisible();
  await expect(page.getByText('Pending review')).toHaveCount(0);
  await page.getByLabel('Plan').selectOption({ index: 1 });
  await page.getByLabel('Payment reference').fill('RCPT-E2E-1');
  await page.getByRole('button', { name: 'Grant / renew' }).click();
  await page.getByRole('dialog').getByLabel(/السبب|Reason/).fill('E2E paid at office');
  await page.getByRole('dialog').getByRole('button', { name: /تأكيد|Confirm/ }).click();
  await expect(page.getByRole('cell', { name: 'E2E paid at office · RCPT-E2E-1' })).toBeVisible();

  // 4. Member card is now active
  const card = await json<{ membership: { state: string }; canShowQr: boolean }>(request, 'get', '/v1/me/card', member);
  expect(card.body).toMatchObject({ canShowQr: true, membership: { state: 'ACTIVE' } });

  // 5. Cashier: scan → match → quote (200 ₪ / 20%)
  const staff = (await json<{ accessToken: string }>(request, 'post', '/v1/auth/login', undefined, { email: 'staff@bitaqati.test', password: 'DevStaff2026!pass' })).body.accessToken;
  const ws = await json<{ merchant: Array<{ stores: Array<{ branches: Array<{ id: string }> }> }> }>(request, 'get', '/v1/me/workspaces', staff);
  const branchId = ws.body.merchant[0].stores[0].branches[0].id;
  const qr = await json<{ payload: string }>(request, 'post', '/v1/me/card/qr-token', member);
  const v = await json<{ id: string; holder: { fullName: string } }>(request, 'post', '/v1/merchant/verifications', staff, { branchId, qrPayload: qr.body.payload });
  expect(v.status).toBe(201);
  expect(v.body.holder.fullName).toBe('E2E Member');
  expect((await request.get(`${API}/v1/merchant/verifications/${v.body.id}/photo`, { headers: { Authorization: `Bearer ${staff}` } })).status()).toBe(200);
  await json(request, 'post', `/v1/merchant/verifications/${v.body.id}/match`, staff, { decision: 'MATCH' });
  const quote = await json<{ id: string; fingerprint: string; discountMinor: number; netMinor: number }>(request, 'post', '/v1/merchant/quotes', staff, { verificationId: v.body.id, grossMinor: 20000 });
  expect(quote.body).toMatchObject({ discountMinor: 4000, netMinor: 16000 });

  // 6. Confirmation before approval is refused; member approves exactly this quote
  const early = await json<{ error: { code: string } }>(request, 'post', '/v1/merchant/redemptions', staff, { quoteId: quote.body.id }, { 'Idempotency-Key': `e2e_early_${Date.now()}` });
  expect(early.body.error.code).toBe('APPROVAL_REQUIRED');
  const pendingApprovals = await json<Array<{ id: string }>>(request, 'get', '/v1/me/approvals/pending', member);
  expect(pendingApprovals.body[0].id).toBe(quote.body.id);
  expect((await json(request, 'post', `/v1/me/approvals/${quote.body.id}/approve`, member, { fingerprint: quote.body.fingerprint })).status).toBe(200);

  // 7. Cashier confirms once; a network retry with the same key returns the same result
  const key = `e2e_${Date.now()}_confirm_key`;
  const confirmed = await json<{ ref: string; status: string; discountMinor: number; netMinor: number }>(request, 'post', '/v1/merchant/redemptions', staff, { quoteId: quote.body.id }, { 'Idempotency-Key': key });
  expect(confirmed.status).toBe(201);
  expect(confirmed.body).toMatchObject({ status: 'CONFIRMED', discountMinor: 4000, netMinor: 16000 });
  const replay = await json<{ ref: string }>(request, 'post', '/v1/merchant/redemptions', staff, { quoteId: quote.body.id }, { 'Idempotency-Key': key });
  expect(replay.body.ref).toBe(confirmed.body.ref);

  // 8. Same store again today is blocked
  const qr2 = await json<{ payload: string }>(request, 'post', '/v1/me/card/qr-token', member);
  const v2 = await json<{ id: string; alreadyRedeemedToday: boolean }>(request, 'post', '/v1/merchant/verifications', staff, { branchId, qrPayload: qr2.body.payload });
  expect(v2.body.alreadyRedeemedToday).toBe(true);
  await json(request, 'post', `/v1/merchant/verifications/${v2.body.id}/match`, staff, { decision: 'MATCH' });
  const q2 = await json<{ error: { code: string } }>(request, 'post', '/v1/merchant/quotes', staff, { verificationId: v2.body.id, grossMinor: 5000 });
  expect(q2.body.error.code).toBe('ALREADY_REDEEMED_TODAY');

  // 9. Member history & home
  const usage = await json<{ items: Array<{ ref: string }> }>(request, 'get', '/v1/me/usage', member);
  expect(usage.body.items.map((i) => i.ref)).toEqual([confirmed.body.ref]);
  const home = await json<{ stats: { totalSavingsMinor: number } }>(request, 'get', '/v1/me/home', member);
  expect(home.body.stats.totalSavingsMinor).toBe(4000);

  // 10. Outbox → in-app notification delivered by the worker
  await expect
    .poll(async () => (await json<{ items: Array<{ type: string }> }>(request, 'get', '/v1/me/notifications', member)).body.items.map((n) => n.type), { timeout: 15_000 })
    .toContain('REDEMPTION_CONFIRMED');

  // 11. Admin sees it on the dashboard and in transactions, then voids it (browser)
  await page.goto('/');
  await expect(page.locator('.kpi').filter({ hasText: /عمليات مؤكدة|Confirmed transactions/ }).locator('.value')).toHaveText('1');
  await page.goto('/redemptions');
  await expect(page.getByRole('cell', { name: confirmed.body.ref })).toBeVisible();
  await page.getByRole('button', { name: /إلغاء العملية|Void/ }).click();
  await page.getByRole('dialog').getByLabel(/السبب|Reason/).fill('E2E void test');
  await page.getByRole('dialog').getByRole('button', { name: /تأكيد|Confirm/ }).click();
  await expect(page.getByText('E2E void test')).toBeVisible();

  // 12. Void restored today's entitlement at this store
  const qr3 = await json<{ payload: string }>(request, 'post', '/v1/me/card/qr-token', member);
  const v3 = await json<{ id: string; alreadyRedeemedToday: boolean }>(request, 'post', '/v1/merchant/verifications', staff, { branchId, qrPayload: qr3.body.payload });
  expect(v3.body.alreadyRedeemedToday).toBe(false);
});

test('admin BFF rejects cross-site requests and unauthenticated access', async ({ request }) => {
  const noCsrf = await request.post('http://localhost:3100/api/proxy/v1/admin/settings', { data: {} });
  expect(noCsrf.status()).toBe(403);
  const unauth = await request.get('http://localhost:3100/api/proxy/v1/admin/users');
  expect(unauth.status()).toBe(401);
  const blocked = await request.get('http://localhost:3100/api/proxy/v1/me');
  expect(blocked.status()).toBe(404);
});
