import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AdminPermission } from '@bitaqati/shared';
import type { AppRequest, AuthContext } from './request-context';
import { AppError } from './errors';

export const IS_PUBLIC = 'isPublic';
export const OPTIONAL_AUTH = 'optionalAuth';
export const ADMIN_PERMS = 'adminPerms';

/** No authentication required. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Authentication used when present, but not required. */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH, true);
/** Requires an MFA-verified admin session holding all listed permissions. */
export const RequireAdmin = (...perms: AdminPermission[]) => SetMetadata(ADMIN_PERMS, perms);

export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.auth) throw new AppError('UNAUTHENTICATED');
  return req.auth;
});

export const MaybeAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext | null => {
  return ctx.switchToHttp().getRequest<AppRequest>().auth ?? null;
});

export const Req = createParamDecorator((_data: unknown, ctx: ExecutionContext): AppRequest => ctx.switchToHttp().getRequest<AppRequest>());
