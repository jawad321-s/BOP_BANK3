import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import { randomBytes } from 'node:crypto';
import type { AuthTokens, LoginResponse } from '@bitaqati/shared';
import { config } from '../config';
import { AuditService } from '../common/audit.service';
import { Clock } from '../common/clock';
import { decryptSecret, encryptSecret, generateSerial, randomToken, sha256, signJwt, verifyJwt } from '../common/crypto';
import { AppError } from '../common/errors';
import { MailService } from '../common/mail.service';
import { isUniqueViolation, PrismaService, type Tx } from '../common/prisma.service';
import { RateLimitService } from '../common/rate-limit.service';

/** Argon2id parameters (OWASP 2024+ baseline: m=19 MiB, t=2, p=1). Documented in docs/security.md. */
const ARGON2_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
let dummyHash: string | null = null;

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
  deviceName?: string;
  platform?: string;
}

authenticator.options = { window: 1 };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly mail: MailService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  hashPassword(p: string): Promise<string> {
    return argon2.hash(p, ARGON2_OPTS);
  }

  async verifyPassword(hash: string | null, p: string): Promise<boolean> {
    if (!hash) {
      // Equalize timing for unknown accounts.
      dummyHash ??= await argon2.hash('dummy-password-for-timing', ARGON2_OPTS);
      await argon2.verify(dummyHash, p).catch(() => false);
      return false;
    }
    return argon2.verify(hash, p).catch(() => false);
  }

  private link(path: string, token: string): string {
    return `${config().PUBLIC_APP_LINK_BASE}${path}?token=${encodeURIComponent(token)}`;
  }

  // ---------------------------------------------------------------- registration

  /** Public registration always creates a plain USER. Response is identical whether or not the email exists. */
  async register(input: { email: string; password: string; fullName: string; locale: 'ar' | 'en' }, ip?: string): Promise<void> {
    await this.rateLimit.hit(`register:ip:${ip ?? 'unknown'}`, 10, 3600);
    await this.rateLimit.hit(`register:email:${input.email}`, 3, 3600);
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      if (existing.status !== 'DELETED') {
        await this.mail.send({
          to: input.email,
          template: 'register-existing',
          subject: input.locale === 'en' ? 'Sign-in attempt' : 'محاولة تسجيل',
          text:
            input.locale === 'en'
              ? 'Someone tried to create an account with this email. If it was you, sign in or reset your password.'
              : 'حاول أحدهم إنشاء حساب بهذا البريد. إن كنت أنت، سجّل الدخول أو أعد تعيين كلمة المرور.',
        });
      }
      return;
    }
    const passwordHash = await this.hashPassword(input.password);
    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            email: input.email,
            passwordHash,
            locale: input.locale,
            profile: { create: { fullName: input.fullName } },
            notificationPrefs: { create: {} },
          },
        });
        await this.issueCard(tx, u.id, 'PENDING');
        return u.id;
      });
    } catch (e) {
      if (isUniqueViolation(e)) return;
      throw e;
    }
    await this.sendVerification(userId, input.email, input.locale);
  }

  async issueCard(tx: Tx, userId: string, status: 'PENDING' | 'ACTIVE'): Promise<{ id: string; serialNumber: string }> {
    for (let i = 0; i < 5; i++) {
      try {
        return await tx.card.create({ data: { userId, serialNumber: generateSerial(), status }, select: { id: true, serialNumber: true } });
      } catch (e) {
        if (!isUniqueViolation(e, 'serial_number')) throw e;
      }
    }
    throw new AppError('INTERNAL_ERROR');
  }

  private async sendVerification(userId: string, email: string, locale: string): Promise<void> {
    const token = randomToken();
    await this.prisma.emailToken.create({
      data: { userId, purpose: 'VERIFY_EMAIL', tokenHash: sha256(token), expiresAt: new Date(this.clock.now().getTime() + 48 * 3600_000) },
    });
    const url = this.link('/verify-email', token);
    await this.mail.send({
      to: email,
      template: 'verify-email',
      subject: locale === 'en' ? 'Confirm your email' : 'تأكيد البريد الإلكتروني',
      text: `${locale === 'en' ? 'Confirm your email:' : 'لتأكيد بريدك الإلكتروني:'} ${url}`,
    });
  }

  async resendVerification(email: string, ip?: string): Promise<void> {
    await this.rateLimit.hit(`verify-resend:${email}`, 3, 3600);
    await this.rateLimit.hit(`verify-resend:ip:${ip ?? 'unknown'}`, 20, 3600);
    const u = await this.prisma.user.findUnique({ where: { email } });
    if (!u || u.emailVerifiedAt || u.status !== 'ACTIVE') return;
    await this.sendVerification(u.id, u.email, u.locale);
  }

  async verifyEmail(token: string): Promise<void> {
    const t = await this.consumeToken(token, 'VERIFY_EMAIL');
    await this.prisma.user.update({ where: { id: t.userId }, data: { emailVerifiedAt: this.clock.now() } });
  }

  private async consumeToken(token: string, purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD' | 'CHANGE_EMAIL') {
    const now = this.clock.now();
    const t = await this.prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!t || t.purpose !== purpose || t.usedAt || t.expiresAt <= now) throw new AppError('TOKEN_INVALID');
    const res = await this.prisma.emailToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: now } });
    if (res.count !== 1) throw new AppError('TOKEN_INVALID');
    return t;
  }

  // ---------------------------------------------------------------- login / sessions

  async login(input: { email: string; password: string; deviceName?: string; platform?: string }, client: ClientInfo): Promise<LoginResponse> {
    await this.rateLimit.hit(`login:email:${input.email}`, 10, 900);
    await this.rateLimit.hit(`login:ip:${client.ip ?? 'unknown'}`, 60, 900);
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const ok = await this.verifyPassword(user && user.status !== 'DELETED' ? user.passwordHash : null, input.password);
    if (!user || !ok) throw new AppError('INVALID_CREDENTIALS');
    if (user.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED');
    if (!user.emailVerifiedAt) throw new AppError('EMAIL_NOT_VERIFIED');
    await this.rateLimit.reset(`login:email:${input.email}`);
    const tokens = await this.createSession(user.id, { ...client, deviceName: input.deviceName, platform: input.platform }, null);
    return { status: 'OK', ...tokens };
  }

  /** Admin login: password, then TOTP. Admin sessions are the only ones that carry mfaVerifiedAt. */
  async adminLogin(input: { email: string; password: string }, client: ClientInfo): Promise<LoginResponse> {
    await this.rateLimit.hit(`admin-login:email:${input.email}`, 5, 900);
    await this.rateLimit.hit(`admin-login:ip:${client.ip ?? 'unknown'}`, 30, 900);
    const user = await this.prisma.user.findUnique({ where: { email: input.email }, include: { adminPermissions: true } });
    const ok = await this.verifyPassword(user && user.status === 'ACTIVE' ? user.passwordHash : null, input.password);
    if (!user || !ok || user.adminPermissions.length === 0) throw new AppError('INVALID_CREDENTIALS');
    if (!user.emailVerifiedAt) throw new AppError('EMAIL_NOT_VERIFIED');
    const { token: challengeToken } = signJwt({ sub: user.id, typ: 'mfa' }, config().JWT_ACCESS_SECRET, 300, this.clock.now().getTime());
    if (!user.mfaEnabledAt) {
      const secret = authenticator.generateSecret();
      await this.prisma.user.update({ where: { id: user.id }, data: { mfaSecretEnc: encryptSecret(secret, config().MFA_ENCRYPTION_KEY) } });
      const otpauthUrl = authenticator.keyuri(user.email, 'Bitaqati Admin', secret);
      return { status: 'MFA_ENROLLMENT_REQUIRED', challengeToken, otpauthUrl, secret };
    }
    return { status: 'MFA_REQUIRED', challengeToken };
  }

  private challengeUser(challengeToken: string): string {
    const c = verifyJwt<{ sub: string; typ: string }>(challengeToken, config().JWT_ACCESS_SECRET, this.clock.now().getTime());
    if (!c || c.typ !== 'mfa') throw new AppError('SESSION_EXPIRED');
    return c.sub;
  }

  async confirmMfaEnrollment(challengeToken: string, code: string, client: ClientInfo): Promise<AuthTokens & { recoveryCodes: string[] }> {
    const userId = this.challengeUser(challengeToken);
    await this.rateLimit.hit(`mfa:${userId}`, 10, 900);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabledAt || !user.mfaSecretEnc) throw new AppError('MFA_INVALID');
    const secret = decryptSecret(user.mfaSecretEnc, config().MFA_ENCRYPTION_KEY);
    if (!authenticator.check(code, secret)) throw new AppError('MFA_INVALID');
    const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(5).toString('hex').toUpperCase());
    await this.prisma.user.update({ where: { id: userId }, data: { mfaEnabledAt: this.clock.now(), mfaRecoveryHashes: recoveryCodes.map((c) => sha256(c)) } });
    await this.audit.log({ actorUserId: userId, action: 'admin.mfa.enrolled', entityType: 'user', entityId: userId });
    const tokens = await this.createSession(userId, { ...client, platform: 'web' }, this.clock.now());
    return { ...tokens, recoveryCodes };
  }

  async verifyMfa(challengeToken: string, code: string, client: ClientInfo): Promise<AuthTokens> {
    const userId = this.challengeUser(challengeToken);
    await this.rateLimit.hit(`mfa:${userId}`, 10, 900);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaEnabledAt || !user.mfaSecretEnc || user.status !== 'ACTIVE') throw new AppError('MFA_INVALID');
    const secret = decryptSecret(user.mfaSecretEnc, config().MFA_ENCRYPTION_KEY);
    const normalized = code.replace(/\s|-/g, '').toUpperCase();
    if (/^\d{6}$/.test(normalized)) {
      if (!authenticator.check(normalized, secret)) throw new AppError('MFA_INVALID');
    } else {
      const h = sha256(normalized);
      if (!user.mfaRecoveryHashes.includes(h)) throw new AppError('MFA_INVALID');
      await this.prisma.user.update({ where: { id: userId }, data: { mfaRecoveryHashes: user.mfaRecoveryHashes.filter((x) => x !== h) } });
      await this.audit.log({ actorUserId: userId, action: 'admin.mfa.recovery_code_used', entityType: 'user', entityId: userId });
    }
    return this.createSession(userId, { ...client, platform: 'web' }, this.clock.now());
  }

  async createSession(userId: string, client: ClientInfo, mfaVerifiedAt: Date | null): Promise<AuthTokens> {
    const now = this.clock.now();
    const c = config();
    const refreshExpires = new Date(now.getTime() + c.REFRESH_TOKEN_TTL_DAYS * 86400_000);
    const refreshToken = randomToken(32);
    const session = await this.prisma.session.create({
      data: {
        userId,
        deviceName: client.deviceName?.slice(0, 100),
        platform: client.platform,
        ip: client.ip,
        userAgent: client.userAgent?.slice(0, 300),
        mfaVerifiedAt,
        expiresAt: refreshExpires,
        refreshTokens: { create: { tokenHash: sha256(refreshToken), expiresAt: refreshExpires } },
      },
    });
    const access = signJwt({ sub: userId, sid: session.id, typ: 'access' }, c.JWT_ACCESS_SECRET, c.ACCESS_TOKEN_TTL_SECONDS, now.getTime());
    return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt.toISOString(), refreshToken, refreshTokenExpiresAt: refreshExpires.toISOString() };
  }

  /**
   * Refresh-token rotation. Each refresh token is single-use; presenting an already-rotated token
   * (possible theft) revokes the entire session.
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const now = this.clock.now();
    const c = config();
    const hash = sha256(refreshToken);
    const rt = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash }, include: { session: { include: { user: true } } } });
    if (!rt) throw new AppError('SESSION_EXPIRED');
    const s = rt.session;
    if (rt.rotatedAt) {
      await this.prisma.session.update({ where: { id: s.id }, data: { revokedAt: now, revokeReason: 'refresh_token_reuse' } });
      await this.audit.log({ actorUserId: s.userId, action: 'session.refresh_reuse_detected', entityType: 'session', entityId: s.id });
      throw new AppError('SESSION_EXPIRED');
    }
    if (s.revokedAt || rt.expiresAt <= now || s.expiresAt <= now || s.user.status !== 'ACTIVE') throw new AppError('SESSION_EXPIRED');
    const claimed = await this.prisma.refreshToken.updateMany({ where: { id: rt.id, rotatedAt: null }, data: { rotatedAt: now } });
    if (claimed.count !== 1) throw new AppError('SESSION_EXPIRED');
    const next = randomToken(32);
    await this.prisma.$transaction([
      this.prisma.refreshToken.create({ data: { sessionId: s.id, tokenHash: sha256(next), expiresAt: s.expiresAt } }),
      this.prisma.session.update({ where: { id: s.id }, data: { lastUsedAt: now } }),
    ]);
    const access = signJwt({ sub: s.userId, sid: s.id, typ: 'access' }, c.JWT_ACCESS_SECRET, c.ACCESS_TOKEN_TTL_SECONDS, now.getTime());
    return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt.toISOString(), refreshToken: next, refreshTokenExpiresAt: s.expiresAt.toISOString() };
  }

  async revokeSession(sessionId: string, reason: string, tx?: Tx): Promise<void> {
    const db = tx ?? this.prisma;
    const now = this.clock.now();
    await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now, revokeReason: reason } });
    await db.qrToken.updateMany({ where: { sessionId, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
    await db.devicePushToken.updateMany({ where: { sessionId, disabledAt: null }, data: { disabledAt: now } });
  }

  async revokeAllSessions(userId: string, reason: string, exceptSessionId?: string, tx?: Tx): Promise<number> {
    const db = tx ?? this.prisma;
    const sessions = await db.session.findMany({ where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) }, select: { id: true } });
    for (const s of sessions) await this.revokeSession(s.id, reason, tx);
    return sessions.length;
  }

  // ---------------------------------------------------------------- password & email

  async forgotPassword(email: string, ip?: string): Promise<void> {
    await this.rateLimit.hit(`forgot:${email}`, 3, 3600);
    await this.rateLimit.hit(`forgot:ip:${ip ?? 'unknown'}`, 20, 3600);
    const u = await this.prisma.user.findUnique({ where: { email } });
    if (!u || u.status === 'DELETED') return;
    // Invalidate older reset tokens so only the newest link works.
    await this.prisma.emailToken.updateMany({ where: { userId: u.id, purpose: 'RESET_PASSWORD', usedAt: null }, data: { usedAt: this.clock.now() } });
    const token = randomToken();
    await this.prisma.emailToken.create({ data: { userId: u.id, purpose: 'RESET_PASSWORD', tokenHash: sha256(token), expiresAt: new Date(this.clock.now().getTime() + 3600_000) } });
    await this.mail.send({
      to: u.email,
      template: 'reset-password',
      subject: u.locale === 'en' ? 'Reset your password' : 'إعادة تعيين كلمة المرور',
      text: `${this.link('/reset-password', token)}`,
    });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const t = await this.consumeToken(token, 'RESET_PASSWORD');
    const passwordHash = await this.hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      // Completing a reset proves control of the mailbox, so the email is also marked verified.
      await tx.user.update({ where: { id: t.userId }, data: { passwordHash, emailVerifiedAt: this.clock.now() } });
      await this.revokeAllSessions(t.userId, 'password_reset', undefined, tx);
      await this.audit.log({ actorUserId: t.userId, action: 'user.password_reset', entityType: 'user', entityId: t.userId }, tx);
    });
  }

  async changePassword(userId: string, sessionId: string, current: string, next: string): Promise<void> {
    await this.rateLimit.hit(`reauth:${userId}`, 10, 900);
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.verifyPassword(u.passwordHash, current))) throw new AppError('REAUTH_REQUIRED');
    const passwordHash = await this.hashPassword(next);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await this.revokeAllSessions(userId, 'password_changed', sessionId, tx);
      await this.audit.log({ actorUserId: userId, action: 'user.password_changed', entityType: 'user', entityId: userId }, tx);
    });
  }

  /** Email change requires the password and a link sent to the NEW address; the old address is notified. */
  async requestEmailChange(userId: string, newEmail: string, password: string): Promise<void> {
    await this.rateLimit.hit(`reauth:${userId}`, 10, 900);
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.verifyPassword(u.passwordHash, password))) throw new AppError('REAUTH_REQUIRED');
    if (newEmail === u.email) return;
    const taken = await this.prisma.user.findUnique({ where: { email: newEmail } });
    if (taken) return; // same response; nothing sent
    const token = randomToken();
    await this.prisma.emailToken.create({ data: { userId, purpose: 'CHANGE_EMAIL', newEmail, tokenHash: sha256(token), expiresAt: new Date(this.clock.now().getTime() + 3600_000) } });
    await this.mail.send({ to: newEmail, template: 'change-email', subject: u.locale === 'en' ? 'Confirm your new email' : 'تأكيد البريد الجديد', text: `${this.link('/confirm-email-change', token)}` });
    await this.mail.send({
      to: u.email,
      template: 'change-email-notice',
      subject: u.locale === 'en' ? 'Email change requested' : 'طلب تغيير البريد',
      text: u.locale === 'en' ? 'A change of your account email was requested. If this was not you, reset your password now.' : 'تم طلب تغيير بريد حسابك. إن لم تكن أنت، أعد تعيين كلمة المرور فورًا.',
    });
  }

  async confirmEmailChange(token: string): Promise<void> {
    const t = await this.consumeToken(token, 'CHANGE_EMAIL');
    if (!t.newEmail) throw new AppError('TOKEN_INVALID');
    try {
      await this.prisma.$transaction(async (tx) => {
        const before = await tx.user.findUniqueOrThrow({ where: { id: t.userId } });
        await tx.user.update({ where: { id: t.userId }, data: { email: t.newEmail!, emailVerifiedAt: this.clock.now() } });
        await this.revokeAllSessions(t.userId, 'email_changed', undefined, tx);
        await this.audit.log({ actorUserId: t.userId, action: 'user.email_changed', entityType: 'user', entityId: t.userId, before: { email: before.email }, after: { email: t.newEmail } }, tx);
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError('EMAIL_TAKEN');
      throw e;
    }
  }

  // ---------------------------------------------------------------- invitations (merchant & admin roles)

  async acceptInvitation(input: { token: string; fullName?: string; password?: string }, client: ClientInfo): Promise<AuthTokens> {
    await this.rateLimit.hit(`invite:ip:${client.ip ?? 'unknown'}`, 20, 3600);
    const now = this.clock.now();
    const inv = await this.prisma.invitation.findUnique({ where: { tokenHash: sha256(input.token) } });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= now) throw new AppError('TOKEN_INVALID');
    const existing = await this.prisma.user.findUnique({ where: { email: inv.email } });
    if (existing) {
      // Existing accounts must re-authenticate: the invitation link alone never grants access to an existing account.
      if (!input.password || !(await this.verifyPassword(existing.passwordHash, input.password))) throw new AppError('REAUTH_REQUIRED');
      if (existing.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED');
    } else if (!input.password || !input.fullName) {
      throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'fullName/password', message: 'required for new accounts' }] });
    }
    const passwordHash = existing ? null : await this.hashPassword(input.password!);
    const userId = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null, revokedAt: null }, data: { acceptedAt: now } });
      if (claimed.count !== 1) throw new AppError('TOKEN_INVALID');
      let uid = existing?.id;
      if (!uid) {
        const u = await tx.user.create({
          data: { email: inv.email, passwordHash: passwordHash!, emailVerifiedAt: now, profile: { create: { fullName: input.fullName! } }, notificationPrefs: { create: {} } },
        });
        await this.issueCard(tx, u.id, 'PENDING');
        uid = u.id;
      } else if (!existing!.emailVerifiedAt) {
        await tx.user.update({ where: { id: uid }, data: { emailVerifiedAt: now } });
      }
      await tx.invitation.update({ where: { id: inv.id }, data: { acceptedByUserId: uid } });
      if (inv.kind === 'ADMIN') {
        for (const p of inv.permissions) {
          await tx.adminPermissionGrant.upsert({ where: { userId_permission: { userId: uid, permission: p } }, create: { userId: uid, permission: p, grantedById: inv.invitedById }, update: {} });
        }
      } else {
        const role = inv.kind === 'MERCHANT_OWNER' ? 'OWNER' : 'STAFF';
        const m = await tx.merchantMembership.upsert({
          where: { userId_merchantId: { userId: uid, merchantId: inv.merchantId! } },
          create: { userId: uid, merchantId: inv.merchantId!, role },
          update: { active: true, ...(role === 'OWNER' ? { role } : {}) },
        });
        if (role === 'STAFF') {
          for (const b of inv.branchIds) {
            await tx.membershipBranch.upsert({ where: { membershipId_branchId: { membershipId: m.id, branchId: b } }, create: { membershipId: m.id, branchId: b }, update: {} });
          }
        }
      }
      await this.audit.log({ actorUserId: uid, action: 'invitation.accepted', entityType: 'invitation', entityId: inv.id, after: { kind: inv.kind, merchantId: inv.merchantId, permissions: inv.permissions, branchIds: inv.branchIds } }, tx);
      return uid;
    });
    return this.createSession(userId, client, null);
  }
}
