import { Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  confirmRedemptionSchema,
  createQuoteSchema,
  createVerificationSchema,
  inviteStaffSchema,
  matchDecisionSchema,
  merchantRedemptionsQuerySchema,
  merchantReportQuerySchema,
  updateStaffBranchesSchema,
} from '@bitaqati/shared';
import { z } from 'zod';
import { Auth, Req } from '../common/decorators';
import type { AppRequest, AuthContext } from '../common/request-context';
import { StorageService } from '../common/storage.service';
import { AppError } from '../common/errors';
import { DocBody, DocQuery, ZBody, ZQuery } from '../common/zod';
import { RedemptionService } from '../domain/redemption.service';
import { MerchantService } from './merchant.service';

const activeSchema = z.object({ active: z.boolean() });

@ApiTags('merchant')
@ApiBearerAuth()
@Controller('v1/merchant')
export class MerchantController {
  constructor(
    private readonly redemptions: RedemptionService,
    private readonly merchant: MerchantService,
    private readonly storage: StorageService,
  ) {}

  @Get('dashboard')
  @DocQuery(merchantReportQuerySchema)
  dashboard(@Auth() a: AuthContext, @ZQuery(merchantReportQuerySchema) q: z.infer<typeof merchantReportQuerySchema>) {
    return this.merchant.dashboard(a.userId, q);
  }

  // ---- verification
  @Post('verifications')
  @HttpCode(201)
  @DocBody(createVerificationSchema)
  createVerification(@Auth() a: AuthContext, @ZBody(createVerificationSchema) body: z.infer<typeof createVerificationSchema>) {
    return this.redemptions.createVerification(a.userId, body);
  }

  @Get('verifications/:id')
  getVerification(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.redemptions.getVerificationForStaff(a.userId, id);
  }

  /** Approved photo of the card holder, only during a live verification at a branch the caller may operate. */
  @Get('verifications/:id/photo')
  async photo(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const key = await this.redemptions.verificationPhotoKey(a.userId, id);
    const buf = await this.storage.get(key);
    if (!buf) throw new AppError('NOT_FOUND');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }

  @Post('verifications/:id/match')
  @HttpCode(200)
  @DocBody(matchDecisionSchema)
  match(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(matchDecisionSchema) body: z.infer<typeof matchDecisionSchema>) {
    return this.redemptions.decideMatch(a.userId, id, body.decision);
  }

  @Post('verifications/:id/cancel')
  @HttpCode(204)
  async cancel(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.redemptions.cancelVerification(a.userId, id);
  }

  // ---- quote & confirm
  @Post('quotes')
  @HttpCode(201)
  @DocBody(createQuoteSchema)
  quote(@Auth() a: AuthContext, @ZBody(createQuoteSchema) body: z.infer<typeof createQuoteSchema>) {
    return this.redemptions.createQuote(a.userId, body);
  }

  @Post('redemptions')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: '16–100 chars [A-Za-z0-9_-]; reuse the same key when retrying the same confirmation.' })
  @DocBody(confirmRedemptionSchema)
  async confirm(
    @Auth() a: AuthContext,
    @Headers('idempotency-key') key: string | undefined,
    @ZBody(confirmRedemptionSchema) body: z.infer<typeof confirmRedemptionSchema>,
    @Res() res: Response,
  ) {
    const result = await this.redemptions.confirm(a.userId, body.quoteId, key);
    res.status(result.status).json(result.body);
  }

  @Get('redemptions')
  @DocQuery(merchantRedemptionsQuerySchema)
  list(@Auth() a: AuthContext, @ZQuery(merchantRedemptionsQuerySchema) q: z.infer<typeof merchantRedemptionsQuerySchema>) {
    return this.merchant.redemptions(a.userId, q);
  }

  @Get('redemptions/:id')
  get(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.merchant.redemption(a.userId, id);
  }

  // ---- staff (owner only)
  @Get('merchants/:merchantId/staff')
  staff(@Auth() a: AuthContext, @Param('merchantId', ParseUUIDPipe) merchantId: string) {
    return this.merchant.staff(a.userId, merchantId);
  }

  @Post('merchants/:merchantId/staff/invitations')
  @HttpCode(201)
  @DocBody(inviteStaffSchema)
  invite(@Auth() a: AuthContext, @Param('merchantId', ParseUUIDPipe) merchantId: string, @ZBody(inviteStaffSchema) body: z.infer<typeof inviteStaffSchema>, @Req() req: AppRequest) {
    return this.merchant.inviteStaff(a.userId, merchantId, body, req.requestId);
  }

  @Delete('merchants/:merchantId/staff/invitations/:invitationId')
  @HttpCode(204)
  async revokeInvite(@Auth() a: AuthContext, @Param('merchantId', ParseUUIDPipe) merchantId: string, @Param('invitationId', ParseUUIDPipe) invitationId: string) {
    await this.merchant.revokeInvitation(a.userId, merchantId, invitationId);
  }

  @Patch('merchants/:merchantId/staff/:membershipId/branches')
  @HttpCode(204)
  @DocBody(updateStaffBranchesSchema)
  async branches(
    @Auth() a: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @ZBody(updateStaffBranchesSchema) body: z.infer<typeof updateStaffBranchesSchema>,
    @Req() req: AppRequest,
  ) {
    await this.merchant.updateStaffBranches(a.userId, merchantId, membershipId, body.branchIds, req.requestId);
  }

  @Patch('merchants/:merchantId/staff/:membershipId/active')
  @HttpCode(204)
  @DocBody(activeSchema)
  async active(
    @Auth() a: AuthContext,
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @ZBody(activeSchema) body: z.infer<typeof activeSchema>,
    @Req() req: AppRequest,
  ) {
    await this.merchant.setStaffActive(a.userId, merchantId, membershipId, body.active, req.requestId);
  }
}
