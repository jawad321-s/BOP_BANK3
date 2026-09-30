import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  acceptInvitationSchema,
  emailOnlySchema,
  loginSchema,
  mfaEnrollConfirmSchema,
  mfaVerifySchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
} from '@bitaqati/shared';
import type { z } from 'zod';
import { Auth, Public, Req } from '../common/decorators';
import type { AppRequest, AuthContext } from '../common/request-context';
import { DocBody, ZBody } from '../common/zod';
import { AuthService, type ClientInfo } from './auth.service';

function client(req: AppRequest): ClientInfo {
  return { ip: req.ip, userAgent: req.headers['user-agent']?.toString() };
}

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(202)
  @DocBody(registerSchema)
  async register(@ZBody(registerSchema) body: z.infer<typeof registerSchema>, @Req() req: AppRequest) {
    await this.auth.register(body, req.ip);
    return { status: 'CHECK_EMAIL' };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @DocBody(tokenSchema)
  async verifyEmail(@ZBody(tokenSchema) body: z.infer<typeof tokenSchema>) {
    await this.auth.verifyEmail(body.token);
    return { status: 'VERIFIED' };
  }

  @Public()
  @Post('verify-email/resend')
  @HttpCode(202)
  @DocBody(emailOnlySchema)
  async resend(@ZBody(emailOnlySchema) body: z.infer<typeof emailOnlySchema>, @Req() req: AppRequest) {
    await this.auth.resendVerification(body.email, req.ip);
    return { status: 'CHECK_EMAIL' };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @DocBody(loginSchema)
  login(@ZBody(loginSchema) body: z.infer<typeof loginSchema>, @Req() req: AppRequest) {
    return this.auth.login(body, client(req));
  }

  @Public()
  @Post('admin/login')
  @HttpCode(200)
  @DocBody(loginSchema)
  adminLogin(@ZBody(loginSchema) body: z.infer<typeof loginSchema>, @Req() req: AppRequest) {
    return this.auth.adminLogin(body, client(req));
  }

  @Public()
  @Post('admin/mfa/enroll')
  @HttpCode(200)
  @DocBody(mfaEnrollConfirmSchema)
  enroll(@ZBody(mfaEnrollConfirmSchema) body: z.infer<typeof mfaEnrollConfirmSchema>, @Req() req: AppRequest) {
    return this.auth.confirmMfaEnrollment(body.challengeToken, body.code, client(req));
  }

  @Public()
  @Post('admin/mfa/verify')
  @HttpCode(200)
  @DocBody(mfaVerifySchema)
  verifyMfa(@ZBody(mfaVerifySchema) body: z.infer<typeof mfaVerifySchema>, @Req() req: AppRequest) {
    return this.auth.verifyMfa(body.challengeToken, body.code, client(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @DocBody(refreshSchema)
  refresh(@ZBody(refreshSchema) body: z.infer<typeof refreshSchema>) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Auth() auth: AuthContext) {
    await this.auth.revokeSession(auth.sessionId, 'logout');
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(202)
  @DocBody(emailOnlySchema)
  async forgot(@ZBody(emailOnlySchema) body: z.infer<typeof emailOnlySchema>, @Req() req: AppRequest) {
    await this.auth.forgotPassword(body.email, req.ip);
    return { status: 'CHECK_EMAIL' };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(200)
  @DocBody(resetPasswordSchema)
  async reset(@ZBody(resetPasswordSchema) body: z.infer<typeof resetPasswordSchema>) {
    await this.auth.resetPassword(body.token, body.password);
    return { status: 'PASSWORD_RESET' };
  }

  @Public()
  @Post('email/confirm-change')
  @HttpCode(200)
  @DocBody(tokenSchema)
  async confirmEmailChange(@ZBody(tokenSchema) body: z.infer<typeof tokenSchema>) {
    await this.auth.confirmEmailChange(body.token);
    return { status: 'EMAIL_CHANGED' };
  }

  @Public()
  @Post('invitations/accept')
  @HttpCode(200)
  @DocBody(acceptInvitationSchema)
  acceptInvitation(@ZBody(acceptInvitationSchema) body: z.infer<typeof acceptInvitationSchema>, @Req() req: AppRequest) {
    return this.auth.acceptInvitation(body, client(req));
  }
}
