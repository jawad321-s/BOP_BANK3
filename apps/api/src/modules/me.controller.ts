import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  approvalDecisionSchema,
  changeEmailSchema,
  changePasswordSchema,
  deletionRequestSchema,
  notificationPrefsSchema,
  paginationSchema,
  pushTokenSchema,
  updateProfileSchema,
  usageQuerySchema,
} from '@bitaqati/shared';
import { z } from 'zod';
import { Auth, Req } from '../common/decorators';
import { MAX_UPLOAD_BYTES } from '../common/image';
import type { AppRequest, AuthContext } from '../common/request-context';
import { DocBody, DocQuery, ZBody, ZQuery } from '../common/zod';
import { RedemptionService } from '../domain/redemption.service';
import { AuthService } from './auth.service';
import { MeService } from './me.service';

const markReadSchema = z.object({ ids: z.union([z.array(z.string().uuid()).max(100), z.literal('all')]) });
const tokenOnly = z.object({ token: z.string().min(10).max(300) });

@ApiTags('me')
@ApiBearerAuth()
@Controller('v1/me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly redemptions: RedemptionService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  get(@Auth() a: AuthContext) {
    return this.me.me(a.userId);
  }

  @Patch()
  @DocBody(updateProfileSchema)
  update(@Auth() a: AuthContext, @ZBody(updateProfileSchema) body: z.infer<typeof updateProfileSchema>) {
    return this.me.updateProfile(a.userId, body);
  }

  @Get('workspaces')
  workspaces(@Auth() a: AuthContext) {
    return this.me.workspaces(a.userId);
  }

  @Get('home')
  home(@Auth() a: AuthContext) {
    return this.me.home(a.userId);
  }

  @Get('card')
  card(@Auth() a: AuthContext) {
    return this.me.card(a.userId);
  }

  @Post('card/qr-token')
  @HttpCode(201)
  qr(@Auth() a: AuthContext) {
    return this.me.issueQr(a.userId, a.sessionId);
  }

  @Get('usage')
  @DocQuery(usageQuerySchema)
  usage(@Auth() a: AuthContext, @ZQuery(usageQuerySchema) q: z.infer<typeof usageQuerySchema>) {
    return this.me.usage(a.userId, q);
  }

  // ---- approvals (customer confirms the exact quote)
  @Get('approvals/pending')
  pending(@Auth() a: AuthContext) {
    return this.redemptions.pendingApprovals(a.userId);
  }

  @Post('approvals/:quoteId/approve')
  @HttpCode(200)
  @DocBody(approvalDecisionSchema)
  approve(@Auth() a: AuthContext, @Param('quoteId', ParseUUIDPipe) id: string, @ZBody(approvalDecisionSchema) body: z.infer<typeof approvalDecisionSchema>) {
    return this.redemptions.decideApproval(a.userId, a.sessionId, id, body.fingerprint, true);
  }

  @Post('approvals/:quoteId/reject')
  @HttpCode(200)
  @DocBody(approvalDecisionSchema)
  reject(@Auth() a: AuthContext, @Param('quoteId', ParseUUIDPipe) id: string, @ZBody(approvalDecisionSchema) body: z.infer<typeof approvalDecisionSchema>) {
    return this.redemptions.decideApproval(a.userId, a.sessionId, id, body.fingerprint, false);
  }

  // ---- manual-lookup confirmation
  @Get('verification-requests')
  verificationRequests(@Auth() a: AuthContext) {
    return this.redemptions.pendingVerificationRequests(a.userId);
  }

  @Post('verification-requests/:id/accept')
  @HttpCode(200)
  acceptVerification(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.redemptions.respondToVerificationRequest(a.userId, id, true);
  }

  @Post('verification-requests/:id/decline')
  @HttpCode(200)
  declineVerification(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.redemptions.respondToVerificationRequest(a.userId, id, false);
  }

  // ---- photo
  @Post('photo')
  @HttpCode(201)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  uploadPhoto(@Auth() a: AuthContext, @UploadedFile() file?: Express.Multer.File) {
    return this.me.uploadPhoto(a.userId, file?.buffer);
  }

  @Get('photo')
  async photo(@Auth() a: AuthContext, @Query('which') which: string | undefined, @Res() res: Response) {
    const buf = await this.me.photo(a.userId, which === 'pending' ? 'pending' : 'approved');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }

  // ---- security
  @Get('sessions')
  sessions(@Auth() a: AuthContext) {
    return this.me.sessions(a.userId, a.sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.me.revokeSession(a.userId, id);
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  async revokeOthers(@Auth() a: AuthContext) {
    return { revoked: await this.auth.revokeAllSessions(a.userId, 'user_revoked_others', a.sessionId) };
  }

  @Post('password')
  @HttpCode(204)
  @DocBody(changePasswordSchema)
  async changePassword(@Auth() a: AuthContext, @ZBody(changePasswordSchema) body: z.infer<typeof changePasswordSchema>) {
    await this.auth.changePassword(a.userId, a.sessionId, body.currentPassword, body.newPassword);
  }

  @Post('email/change')
  @HttpCode(202)
  @DocBody(changeEmailSchema)
  async changeEmail(@Auth() a: AuthContext, @ZBody(changeEmailSchema) body: z.infer<typeof changeEmailSchema>) {
    await this.auth.requestEmailChange(a.userId, body.newEmail, body.password);
    return { status: 'CHECK_EMAIL' };
  }

  // ---- notifications
  @Get('notifications')
  @DocQuery(paginationSchema)
  notifications(@Auth() a: AuthContext, @ZQuery(paginationSchema) q: z.infer<typeof paginationSchema>, @Req() req: AppRequest) {
    return this.me.notifications(a.userId, q.cursor, q.limit, req.locale);
  }

  @Post('notifications/read')
  @HttpCode(204)
  @DocBody(markReadSchema)
  async markRead(@Auth() a: AuthContext, @ZBody(markReadSchema) body: z.infer<typeof markReadSchema>) {
    await this.me.markRead(a.userId, body.ids);
  }

  @Get('notification-preferences')
  prefs(@Auth() a: AuthContext) {
    return this.me.prefs(a.userId);
  }

  @Patch('notification-preferences')
  @DocBody(notificationPrefsSchema)
  updatePrefs(@Auth() a: AuthContext, @ZBody(notificationPrefsSchema) body: z.infer<typeof notificationPrefsSchema>) {
    return this.me.updatePrefs(a.userId, body);
  }

  @Post('push-tokens')
  @HttpCode(204)
  @DocBody(pushTokenSchema)
  async pushToken(@Auth() a: AuthContext, @ZBody(pushTokenSchema) body: z.infer<typeof pushTokenSchema>) {
    await this.me.registerPushToken(a.userId, a.sessionId, body.token, body.platform);
  }

  @Post('push-tokens/remove')
  @HttpCode(204)
  @DocBody(tokenOnly)
  async removePush(@Auth() a: AuthContext, @ZBody(tokenOnly) body: z.infer<typeof tokenOnly>) {
    await this.me.removePushToken(a.userId, body.token);
  }

  // ---- deletion
  @Post('deletion-request')
  @HttpCode(200)
  @DocBody(deletionRequestSchema)
  deletion(@Auth() a: AuthContext, @ZBody(deletionRequestSchema) body: z.infer<typeof deletionRequestSchema>) {
    return this.me.deleteAccount(a.userId, body.password);
  }
}

