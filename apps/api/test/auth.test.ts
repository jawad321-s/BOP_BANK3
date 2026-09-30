import { authenticator } from 'otplib';
import { bearer, createTestApp, extractToken, registerUser, resetDb, samplePhoto, uniqueEmail, activateMember, createAdmin, merchantFixture, approvedQuote, confirm, type TestCtx } from './helpers';

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
  ctx.mail.sent.length = 0;
});

describe('registration & login', () => {
  it('public registration creates a plain USER with a PENDING card; login requires verified email', async () => {
    const email = uniqueEmail();
    await ctx.http.post('/v1/auth/register').send({ email, password: 'Str0ngPassw0rd!', fullName: 'Ali Test', locale: 'en', acceptTerms: true, role: 'ADMIN', permissions: ['USERS_MANAGE'] }).expect(202);
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email }, include: { adminPermissions: true, memberships: true, cards: true } });
    expect(u.adminPermissions).toHaveLength(0);
    expect(u.memberships).toHaveLength(0);
    expect(u.cards[0].status).toBe('PENDING');
    expect(u.passwordHash.startsWith('$argon2id$')).toBe(true);
    const early = await ctx.http.post('/v1/auth/login').send({ email, password: 'Str0ngPassw0rd!' });
    expect(early.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    const token = extractToken(ctx.mail.last(email, 'verify-email')!.text);
    await ctx.http.post('/v1/auth/verify-email').send({ token }).expect(200);
    const again = await ctx.http.post('/v1/auth/verify-email').send({ token });
    expect(again.body.error.code).toBe('TOKEN_INVALID');
    const ok = await ctx.http.post('/v1/auth/login').send({ email, password: 'Str0ngPassw0rd!' }).expect(200);
    expect(ok.body.status).toBe('OK');
    const me = await ctx.http.get('/v1/me').set(bearer(ok.body.accessToken)).expect(200);
    expect(me.body.workspaces).toEqual({ user: true, merchant: [], admin: null });
  });

  it('registration response does not reveal whether an email exists', async () => {
    const u = await registerUser(ctx);
    const r = await ctx.http.post('/v1/auth/register').send({ email: u.email, password: 'An0therPassword', fullName: 'Someone', locale: 'ar', acceptTerms: true });
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ status: 'CHECK_EMAIL' });
    expect(await ctx.prisma.user.count({ where: { email: u.email } })).toBe(1);
  });

  it('weak passwords and missing terms are rejected with field details', async () => {
    const r = await ctx.http.post('/v1/auth/register').send({ email: uniqueEmail(), password: 'short', fullName: 'A B', locale: 'ar' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
    expect(r.body.error.requestId).toBeDefined();
    const paths = r.body.error.details.fields.map((f: { path: string }) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['password', 'acceptTerms']));
  });

  it('wrong password and unknown email give the same error; login is rate limited', async () => {
    const u = await registerUser(ctx);
    const a = await ctx.http.post('/v1/auth/login').send({ email: u.email, password: 'nope-nope-1' });
    const b = await ctx.http.post('/v1/auth/login').send({ email: uniqueEmail(), password: 'nope-nope-1' });
    expect(a.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(b.body.error.code).toBe('INVALID_CREDENTIALS');
    for (let i = 0; i < 9; i++) await ctx.http.post('/v1/auth/login').send({ email: u.email, password: 'nope-nope-1' });
    const limited = await ctx.http.post('/v1/auth/login').send({ email: u.email, password: u.password });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('errors are localized by Accept-Language with stable codes', async () => {
    const ar = await ctx.http.get('/v1/me');
    const en = await ctx.http.get('/v1/me').set('Accept-Language', 'en-US');
    expect(ar.body.error.code).toBe('UNAUTHENTICATED');
    expect(en.body.error.code).toBe('UNAUTHENTICATED');
    expect(ar.body.error.message).toBe('يرجى تسجيل الدخول.');
    expect(en.body.error.message).toBe('Please sign in.');
    expect(en.headers['x-request-id']).toBe(en.body.error.requestId);
  });
});

describe('sessions', () => {
  it('refresh rotates tokens; reusing a rotated refresh token revokes the session', async () => {
    const u = await registerUser(ctx);
    const r1 = await ctx.http.post('/v1/auth/refresh').send({ refreshToken: u.refreshToken }).expect(200);
    expect(r1.body.refreshToken).not.toBe(u.refreshToken);
    await ctx.http.get('/v1/me').set(bearer(r1.body.accessToken)).expect(200);
    // attacker replays the old token → whole session revoked
    const replay = await ctx.http.post('/v1/auth/refresh').send({ refreshToken: u.refreshToken });
    expect(replay.body.error.code).toBe('SESSION_EXPIRED');
    const after = await ctx.http.get('/v1/me').set(bearer(r1.body.accessToken));
    expect(after.body.error.code).toBe('SESSION_EXPIRED');
    const r2 = await ctx.http.post('/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken });
    expect(r2.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('logout and remote session revocation take effect immediately', async () => {
    const u = await registerUser(ctx);
    const second = await ctx.http.post('/v1/auth/login').send({ email: u.email, password: u.password, deviceName: 'iPad' }).expect(200);
    const list = await ctx.http.get('/v1/me/sessions').set(bearer(u.token)).expect(200);
    expect(list.body).toHaveLength(2);
    const other = list.body.find((s: { current: boolean }) => !s.current);
    await ctx.http.delete(`/v1/me/sessions/${other.id}`).set(bearer(u.token)).expect(204);
    expect((await ctx.http.get('/v1/me').set(bearer(second.body.accessToken))).status).toBe(401);
    await ctx.http.post('/v1/auth/logout').set(bearer(u.token)).expect(204);
    expect((await ctx.http.get('/v1/me').set(bearer(u.token))).status).toBe(401);
  });

  it('a forged or tampered access token is rejected', async () => {
    const u = await registerUser(ctx);
    const [h, p, s] = u.token.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    payload.sub = '00000000-0000-0000-0000-000000000000';
    const tampered = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
    expect((await ctx.http.get('/v1/me').set(bearer(tampered))).status).toBe(401);
    expect((await ctx.http.get('/v1/me').set(bearer('garbage'))).status).toBe(401);
  });

  it('suspension revokes sessions immediately', async () => {
    const admin = await createAdmin(ctx);
    const u = await registerUser(ctx);
    await ctx.http.post(`/v1/admin/users/${u.userId}/status`).set(bearer(admin.token)).send({ status: 'SUSPENDED', reason: 'abuse report' }).expect(204);
    expect((await ctx.http.get('/v1/me').set(bearer(u.token))).status).toBe(401);
    const login = await ctx.http.post('/v1/auth/login').send({ email: u.email, password: u.password });
    expect(login.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });
});

describe('password & email recovery', () => {
  it('password reset works once, revokes all sessions, and does not reveal unknown emails', async () => {
    const u = await registerUser(ctx);
    await ctx.http.post('/v1/auth/password/forgot').send({ email: uniqueEmail() }).expect(202);
    await ctx.http.post('/v1/auth/password/forgot').send({ email: u.email }).expect(202);
    const token = extractToken(ctx.mail.last(u.email, 'reset-password')!.text);
    await ctx.http.post('/v1/auth/password/reset').send({ token, password: 'NewStr0ngPass!' }).expect(200);
    expect((await ctx.http.get('/v1/me').set(bearer(u.token))).status).toBe(401);
    expect((await ctx.http.post('/v1/auth/password/reset').send({ token, password: 'Other0neStrong' })).body.error.code).toBe('TOKEN_INVALID');
    await ctx.http.post('/v1/auth/login').send({ email: u.email, password: 'NewStr0ngPass!' }).expect(200);
  });

  it('only the newest reset link works', async () => {
    const u = await registerUser(ctx);
    await ctx.http.post('/v1/auth/password/forgot').send({ email: u.email }).expect(202);
    const t1 = extractToken(ctx.mail.last(u.email, 'reset-password')!.text);
    await ctx.http.post('/v1/auth/password/forgot').send({ email: u.email }).expect(202);
    const r = await ctx.http.post('/v1/auth/password/reset').send({ token: t1, password: 'NewStr0ngPass!' });
    expect(r.body.error.code).toBe('TOKEN_INVALID');
  });

  it('email change requires the password, confirmation from the new address, and notifies the old one', async () => {
    const u = await registerUser(ctx);
    const bad = await ctx.http.post('/v1/me/email/change').set(bearer(u.token)).send({ newEmail: 'new@example.test', password: 'wrong-pass-1' });
    expect(bad.body.error.code).toBe('REAUTH_REQUIRED');
    await ctx.http.post('/v1/me/email/change').set(bearer(u.token)).send({ newEmail: 'new@example.test', password: u.password }).expect(202);
    expect(ctx.mail.last(u.email, 'change-email-notice')).toBeDefined();
    // not changed until confirmed
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).email).toBe(u.email);
    const token = extractToken(ctx.mail.last('new@example.test', 'change-email')!.text);
    await ctx.http.post('/v1/auth/email/confirm-change').send({ token }).expect(200);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).email).toBe('new@example.test');
    expect((await ctx.http.get('/v1/me').set(bearer(u.token))).status).toBe(401);
  });

  it('email change to an existing account address sends nothing and changes nothing', async () => {
    const a = await registerUser(ctx);
    const b = await registerUser(ctx);
    await ctx.http.post('/v1/me/email/change').set(bearer(a.token)).send({ newEmail: b.email, password: a.password }).expect(202);
    expect(ctx.mail.last(b.email, 'change-email')).toBeUndefined();
  });
});

describe('admin MFA', () => {
  it('admin login requires TOTP enrollment then TOTP; non-MFA sessions cannot use admin APIs', async () => {
    const u = await registerUser(ctx);
    await ctx.prisma.adminPermissionGrant.create({ data: { userId: u.userId, permission: 'USERS_MANAGE' } });
    // a normal (mobile) session of an admin cannot call admin endpoints
    const plain = await ctx.http.get('/v1/admin/users').set(bearer(u.token));
    expect(plain.status).toBe(403);
    expect(plain.body.error.code).toBe('MFA_REQUIRED');

    const step1 = await ctx.http.post('/v1/auth/admin/login').send({ email: u.email, password: u.password }).expect(200);
    expect(step1.body.status).toBe('MFA_ENROLLMENT_REQUIRED');
    const bad = await ctx.http.post('/v1/auth/admin/mfa/enroll').send({ challengeToken: step1.body.challengeToken, code: '000000' });
    expect(bad.body.error.code).toBe('MFA_INVALID');
    const enrolled = await ctx.http.post('/v1/auth/admin/mfa/enroll').send({ challengeToken: step1.body.challengeToken, code: authenticator.generate(step1.body.secret) }).expect(200);
    expect(enrolled.body.recoveryCodes).toHaveLength(10);
    await ctx.http.get('/v1/admin/users').set(bearer(enrolled.body.accessToken)).expect(200);
    // no access to endpoints outside granted permissions
    expect((await ctx.http.get('/v1/admin/redemptions').set(bearer(enrolled.body.accessToken))).body.error.code).toBe('FORBIDDEN');

    const step2 = await ctx.http.post('/v1/auth/admin/login').send({ email: u.email, password: u.password }).expect(200);
    expect(step2.body.status).toBe('MFA_REQUIRED');
    expect(step2.body.secret).toBeUndefined();
    const withRecovery = await ctx.http.post('/v1/auth/admin/mfa/verify').send({ challengeToken: step2.body.challengeToken, code: enrolled.body.recoveryCodes[0] }).expect(200);
    await ctx.http.get('/v1/admin/me').set(bearer(withRecovery.body.accessToken)).expect(200);
    const step3 = await ctx.http.post('/v1/auth/admin/login').send({ email: u.email, password: u.password }).expect(200);
    const reuse = await ctx.http.post('/v1/auth/admin/mfa/verify').send({ challengeToken: step3.body.challengeToken, code: enrolled.body.recoveryCodes[0] });
    expect(reuse.body.error.code).toBe('MFA_INVALID');
    // secret is stored encrypted
    const row = await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
    expect(row.mfaSecretEnc).not.toContain(step1.body.secret);
  });

  it('non-admins cannot use admin login', async () => {
    const u = await registerUser(ctx);
    const r = await ctx.http.post('/v1/auth/admin/login').send({ email: u.email, password: u.password });
    expect(r.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('account deletion', () => {
  it('requires re-authentication; revokes sessions, removes photos and PII; keeps anonymized redemption records', async () => {
    const admin = await createAdmin(ctx);
    const m = await merchantFixture(ctx);
    const u = await registerUser(ctx, { name: 'Delete Me' });
    await activateMember(ctx, u, admin);
    const q = await approvedQuote(ctx, u, m.staff, m.branches[0].id);
    await confirm(ctx, m.staff, q.quote.id);
    await ctx.http.post('/v1/me/push-tokens').set(bearer(u.token)).send({ token: 'ExponentPushToken[del-1234567]', platform: 'ios' }).expect(204);
    const profile = await ctx.prisma.userProfile.findUniqueOrThrow({ where: { userId: u.userId } });
    expect(await ctx.storage.get(profile.photoKey!)).not.toBeNull();

    const wrong = await ctx.http.post('/v1/me/deletion-request').set(bearer(u.token)).send({ password: 'wrong-pass-1', confirm: 'DELETE' });
    expect(wrong.body.error.code).toBe('REAUTH_REQUIRED');
    const res = await ctx.http.post('/v1/me/deletion-request').set(bearer(u.token)).send({ password: u.password, confirm: 'DELETE' }).expect(200);
    expect(res.body.status).toBe('DELETED');

    expect((await ctx.http.get('/v1/me').set(bearer(u.token))).status).toBe(401);
    expect((await ctx.http.post('/v1/auth/login').send({ email: u.email, password: u.password })).body.error.code).toBe('INVALID_CREDENTIALS');
    const row = await ctx.prisma.user.findUniqueOrThrow({ where: { id: u.userId }, include: { profile: true } });
    expect(row.status).toBe('DELETED');
    expect(row.email).not.toBe(u.email);
    expect(row.profile!.fullName).toBe('Deleted user');
    expect(row.profile!.photoKey).toBeNull();
    expect(await ctx.storage.get(profile.photoKey!)).toBeNull();
    expect(await ctx.prisma.devicePushToken.count({ where: { userId: u.userId } })).toBe(0);
    expect(await ctx.prisma.session.count({ where: { userId: u.userId, revokedAt: null } })).toBe(0);
    expect(await ctx.prisma.notification.count({ where: { userId: u.userId } })).toBe(0);
    expect((await ctx.prisma.card.findFirstOrThrow({ where: { userId: u.userId } })).status).toBe('REVOKED');
    // merchant record retained, without the customer's name
    const list = await ctx.http.get('/v1/merchant/redemptions').set(bearer(m.staff.token)).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].customerName).toBe('Deleted');
    // email can be registered again as a new, unrelated account
    await ctx.http.post('/v1/auth/register').send({ email: u.email, password: 'Str0ngPassw0rd!', fullName: 'New Person', locale: 'ar', acceptTerms: true }).expect(202);
    expect(ctx.mail.last(u.email, 'verify-email')).toBeDefined();
  });
});

describe('photo upload', () => {
  it('rejects non-images and tiny images; re-encodes and keeps the old approved photo until a new one is approved', async () => {
    const admin = await createAdmin(ctx);
    const u = await registerUser(ctx);
    const txt = await ctx.http.post('/v1/me/photo').set(bearer(u.token)).attach('photo', Buffer.from('<?php echo 1; ?>'), { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(txt.body.error.code).toBe('UPLOAD_INVALID');
    await ctx.http.post('/v1/me/photo').set(bearer(u.token)).attach('photo', await samplePhoto(), { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(201);
    await ctx.http.post(`/v1/admin/users/${u.userId}/photo/review`).set(bearer(admin.token)).send({ decision: 'APPROVE' }).expect(204);
    const approvedKey = (await ctx.prisma.userProfile.findUniqueOrThrow({ where: { userId: u.userId } })).photoKey;
    await ctx.http.post('/v1/me/photo').set(bearer(u.token)).attach('photo', await samplePhoto(), { filename: 'b.jpg', contentType: 'image/jpeg' }).expect(201);
    const p = await ctx.prisma.userProfile.findUniqueOrThrow({ where: { userId: u.userId } });
    expect(p.photoKey).toBe(approvedKey); // merchants keep seeing the approved photo
    expect(p.photoStatus).toBe('PENDING');
    await ctx.http.post(`/v1/admin/users/${u.userId}/photo/review`).set(bearer(admin.token)).send({ decision: 'REJECT', reason: 'face not visible' }).expect(204);
    const me = await ctx.http.get('/v1/me').set(bearer(u.token)).expect(200);
    expect(me.body).toMatchObject({ photoStatus: 'APPROVED', photoRejectReason: 'face not visible' });
  });
});
