import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminPermission } from '@bitaqati/shared';
import { config } from '../config';
import { verifyJwt } from './crypto';
import { ADMIN_PERMS, IS_PUBLIC, OPTIONAL_AUTH } from './decorators';
import { AppError } from './errors';
import { PrismaService } from './prisma.service';
import type { AppRequest } from './request-context';
import { Clock } from './clock';

/**
 * Global authentication + admin authorization guard.
 * Every authenticated request re-checks that the session is live and the user active, so
 * logout, suspension and deletion take effect immediately (not at access-token expiry).
 * Merchant scope checks happen in services (per record), not here.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const handlers = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, handlers);
    const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH, handlers);
    const perms = this.reflector.getAllAndOverride<AdminPermission[] | undefined>(ADMIN_PERMS, handlers);

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      if (isPublic || optional) return true;
      throw new AppError('UNAUTHENTICATED');
    }
    const now = this.clock.now();
    const claims = verifyJwt<{ sub: string; sid: string; typ: string }>(header.slice(7), config().JWT_ACCESS_SECRET, now.getTime());
    if (!claims || claims.typ !== 'access') {
      if (isPublic) return true;
      throw new AppError('SESSION_EXPIRED');
    }
    const session = await this.prisma.session.findUnique({
      where: { id: claims.sid },
      select: { id: true, userId: true, revokedAt: true, expiresAt: true, mfaVerifiedAt: true, user: { select: { status: true } } },
    });
    if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt <= now) {
      throw new AppError('SESSION_EXPIRED');
    }
    if (session.user.status !== 'ACTIVE') throw new AppError(session.user.status === 'SUSPENDED' ? 'ACCOUNT_SUSPENDED' : 'SESSION_EXPIRED');
    req.auth = { userId: session.userId, sessionId: session.id, mfaVerified: !!session.mfaVerifiedAt };

    if (perms) {
      if (!session.mfaVerifiedAt) throw new AppError('MFA_REQUIRED', undefined, 403);
      const grants = await this.prisma.adminPermissionGrant.findMany({ where: { userId: session.userId }, select: { permission: true } });
      if (grants.length === 0) throw new AppError('FORBIDDEN');
      const have = new Set(grants.map((g) => g.permission));
      if (!perms.every((p) => have.has(p))) throw new AppError('FORBIDDEN');
    }
    return true;
  }
}
