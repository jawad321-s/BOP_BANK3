import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ADMIN_PERMISSIONS,
  adminRedemptionsQuerySchema,
  adminUsersQuerySchema,
  branchSchema,
  broadcastSchema,
  cancelSubscriptionSchema,
  cardActionSchema,
  categorySchema,
  grantSubscriptionSchema,
  inviteSchema,
  merchantSchema,
  offerSchema,
  paginationSchema,
  photoReviewSchema,
  planSchema,
  reasonSchema,
  reportQuerySchema,
  settingsSchema,
  statusChangeSchema,
  storeSchema,
  audienceSchema,
} from '@bitaqati/shared';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { Auth, Req, RequireAdmin } from '../common/decorators';
import { MAX_UPLOAD_BYTES } from '../common/image';
import { PrismaService } from '../common/prisma.service';
import type { AppRequest, AuthContext } from '../common/request-context';
import { SettingsService } from '../common/settings.service';
import { DocBody, DocQuery, ZBody, ZQuery } from '../common/zod';
import { RedemptionService } from '../domain/redemption.service';
import { BroadcastService } from '../notifications/broadcast.service';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminReportsService } from './admin-reports.service';
import { AdminUsersService } from './admin-users.service';

const dashboardQuery = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const auditQuery = paginationSchema.extend({ entityType: z.string().max(40).optional(), entityId: z.string().max(64).optional(), action: z.string().max(60).optional() });
const permissionsSchema = z.object({ permissions: z.array(z.enum(ADMIN_PERMISSIONS)).max(ADMIN_PERMISSIONS.length), reason: z.string().trim().min(3).max(500) });
const membershipActiveSchema = z.object({ active: z.boolean(), reason: z.string().trim().min(3).max(500) });
const previewSchema = z.object({ audience: audienceSchema, marketing: z.boolean().default(true) });

@ApiTags('admin')
@ApiBearerAuth()
@Controller('v1/admin')
export class AdminController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly catalog: AdminCatalogService,
    private readonly reports: AdminReportsService,
    private readonly redemptions: RedemptionService,
    private readonly broadcasts: BroadcastService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  private async perms(userId: string): Promise<Set<string>> {
    const g = await this.prisma.adminPermissionGrant.findMany({ where: { userId } });
    return new Set(g.map((x) => x.permission));
  }

  // ---------------------------------------------------------------- dashboard & reports
  @RequireAdmin('REPORTS_VIEW')
  @Get('dashboard')
  @DocQuery(dashboardQuery)
  dashboard(@ZQuery(dashboardQuery) q: z.infer<typeof dashboardQuery>) {
    return this.reports.dashboard(q.from, q.to);
  }

  @RequireAdmin('REPORTS_VIEW')
  @Get('reports/timeseries')
  @DocQuery(reportQuerySchema)
  timeseries(@ZQuery(reportQuerySchema) q: z.infer<typeof reportQuerySchema>) {
    return this.reports.timeseries(q);
  }

  @RequireAdmin('AUDIT_VIEW')
  @Get('audit-logs')
  @DocQuery(auditQuery)
  auditLogs(@ZQuery(auditQuery) q: z.infer<typeof auditQuery>) {
    return this.reports.auditLogs(q);
  }

  @RequireAdmin()
  @Get('me')
  async me(@Auth() a: AuthContext) {
    return { userId: a.userId, permissions: [...(await this.perms(a.userId))] };
  }

  // ---------------------------------------------------------------- users
  @RequireAdmin('USERS_MANAGE')
  @Get('users')
  @DocQuery(adminUsersQuerySchema)
  listUsers(@ZQuery(adminUsersQuerySchema) q: z.infer<typeof adminUsersQuerySchema>) {
    return this.users.list(q);
  }

  @RequireAdmin('USERS_MANAGE')
  @Get('users/:id')
  user(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.detail(id);
  }

  @RequireAdmin('PHOTOS_REVIEW')
  @Get('users/:id/photo')
  async photo(@Param('id', ParseUUIDPipe) id: string, @Query('which') which: string | undefined, @Res() res: Response) {
    const buf = await this.users.photo(id, which === 'pending' ? 'pending' : 'approved');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }

  @RequireAdmin('PHOTOS_REVIEW')
  @Post('users/:id/photo/review')
  @HttpCode(204)
  @DocBody(photoReviewSchema)
  async review(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(photoReviewSchema) body: z.infer<typeof photoReviewSchema>, @Req() req: AppRequest) {
    await this.users.reviewPhoto(a.userId, id, body, req.requestId);
  }

  @RequireAdmin('USERS_MANAGE')
  @Post('users/:id/status')
  @HttpCode(204)
  @DocBody(statusChangeSchema)
  async userStatus(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(statusChangeSchema) body: z.infer<typeof statusChangeSchema>, @Req() req: AppRequest) {
    await this.users.setUserStatus(a.userId, id, body.status, body.reason, req.requestId);
  }

  @RequireAdmin('USERS_MANAGE')
  @Post('users/:id/card')
  @DocBody(cardActionSchema)
  card(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(cardActionSchema) body: z.infer<typeof cardActionSchema>, @Req() req: AppRequest) {
    return this.users.cardAction(a.userId, id, body.action, body.reason, req.requestId);
  }

  @RequireAdmin('SUBSCRIPTIONS_MANAGE')
  @Post('users/:id/subscriptions')
  @HttpCode(201)
  @DocBody(grantSubscriptionSchema)
  grant(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(grantSubscriptionSchema) body: z.infer<typeof grantSubscriptionSchema>, @Req() req: AppRequest) {
    return this.users.grantSubscription(a.userId, id, body, req.requestId);
  }

  @RequireAdmin('SUBSCRIPTIONS_MANAGE')
  @Post('subscriptions/:id/cancel')
  @HttpCode(204)
  @DocBody(cancelSubscriptionSchema)
  async cancelSub(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(cancelSubscriptionSchema) body: z.infer<typeof cancelSubscriptionSchema>, @Req() req: AppRequest) {
    await this.users.cancelSubscription(a.userId, id, body.reason, req.requestId);
  }

  @RequireAdmin('ADMINS_MANAGE')
  @Post('users/:id/admin-permissions')
  @HttpCode(204)
  @DocBody(permissionsSchema)
  async setPerms(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(permissionsSchema) body: z.infer<typeof permissionsSchema>, @Req() req: AppRequest) {
    await this.users.setAdminPermissions(a.userId, id, body.permissions, body.reason, req.requestId);
  }

  @RequireAdmin('ADMINS_MANAGE')
  @Post('users/:id/mfa/reset')
  @HttpCode(204)
  @DocBody(reasonSchema)
  async resetMfa(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(reasonSchema) body: z.infer<typeof reasonSchema>, @Req() req: AppRequest) {
    await this.users.resetMfa(a.userId, id, body.reason, req.requestId);
  }

  // ---------------------------------------------------------------- plans
  @RequireAdmin('SUBSCRIPTIONS_MANAGE')
  @Get('plans')
  plans() {
    return this.catalog.plans();
  }

  @RequireAdmin('SUBSCRIPTIONS_MANAGE')
  @Post('plans')
  @HttpCode(201)
  @DocBody(planSchema)
  createPlan(@Auth() a: AuthContext, @ZBody(planSchema) body: z.infer<typeof planSchema>) {
    return this.catalog.createPlan(a.userId, body);
  }

  @RequireAdmin('SUBSCRIPTIONS_MANAGE')
  @Patch('plans/:id')
  @DocBody(planSchema.partial())
  updatePlan(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(planSchema.partial()) body: Partial<z.infer<typeof planSchema>>) {
    return this.catalog.updatePlan(a.userId, id, body);
  }

  // ---------------------------------------------------------------- merchants / stores / branches / offers
  @RequireAdmin('MERCHANTS_MANAGE')
  @Get('merchants')
  merchants(@Query('q') q?: string) {
    return this.catalog.merchants(q?.slice(0, 100));
  }

  @RequireAdmin('MERCHANTS_MANAGE')
  @Get('merchants/:id')
  merchant(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.merchant(id);
  }

  @RequireAdmin('MERCHANTS_MANAGE')
  @Post('merchants')
  @HttpCode(201)
  @DocBody(merchantSchema)
  createMerchant(@Auth() a: AuthContext, @ZBody(merchantSchema) body: z.infer<typeof merchantSchema>, @Req() req: AppRequest) {
    return this.catalog.createMerchant(a.userId, body, req.requestId);
  }

  @RequireAdmin('MERCHANTS_MANAGE')
  @Patch('merchants/:id')
  @DocBody(merchantSchema.partial())
  updateMerchant(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(merchantSchema.partial()) body: Partial<z.infer<typeof merchantSchema>>, @Req() req: AppRequest) {
    return this.catalog.updateMerchant(a.userId, id, body, req.requestId);
  }

  @RequireAdmin('MERCHANTS_MANAGE')
  @Post('merchants/:id/status')
  @HttpCode(204)
  @DocBody(statusChangeSchema)
  async merchantStatus(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(statusChangeSchema) body: z.infer<typeof statusChangeSchema>, @Req() req: AppRequest) {
    await this.catalog.setMerchantStatus(a.userId, id, body.status, body.reason, req.requestId);
  }

  @RequireAdmin('MERCHANTS_MANAGE')
  @Post('memberships/:id/active')
  @HttpCode(204)
  @DocBody(membershipActiveSchema)
  async membershipActive(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(membershipActiveSchema) body: z.infer<typeof membershipActiveSchema>) {
    await this.catalog.setMembershipActive(a.userId, id, body.active, body.reason);
  }

  @RequireAdmin('MERCHANTS_MANAGE')
  @Get('categories')
  categories() {
    return this.catalog.categories();
  }

  @RequireAdmin('MERCHANTS_MANAGE')
  @Post('categories')
  @HttpCode(201)
  @DocBody(categorySchema)
  createCategory(@Auth() a: AuthContext, @ZBody(categorySchema) body: z.infer<typeof categorySchema>) {
    return this.catalog.createCategory(a.userId, body);
  }

  @RequireAdmin('MERCHANTS_MANAGE')
  @Patch('categories/:id')
  @DocBody(categorySchema.partial())
  updateCategory(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(categorySchema.partial()) body: Partial<z.infer<typeof categorySchema>>) {
    return this.catalog.updateCategory(a.userId, id, body);
  }

  @RequireAdmin('MERCHANTS_MANAGE')
  @Post('stores')
  @HttpCode(201)
  @DocBody(storeSchema)
  createStore(@Auth() a: AuthContext, @ZBody(storeSchema) body: z.infer<typeof storeSchema>, @Req() req: AppRequest) {
    return this.catalog.createStore(a.userId, body, req.requestId);
  }

  @RequireAdmin('MERCHANTS_MANAGE')
  @Patch('stores/:id')
  @DocBody(storeSchema.omit({ merchantId: true }).partial())
  updateStore(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(storeSchema.omit({ merchantId: true }).partial()) body: Record<string, string>, @Req() req: AppRequest) {
    return this.catalog.updateStore(a.userId, id, body, req.requestId);
  }

  @RequireAdmin('MERCHANTS_MANAGE')
  @Post('stores/:id/status')
  @HttpCode(204)
  @DocBody(statusChangeSchema)
  async storeStatus(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(statusChangeSchema) body: z.infer<typeof statusChangeSchema>, @Req() req: AppRequest) {
    await this.catalog.setStoreStatus(a.userId, id, body.status, body.reason, req.requestId);
  }

  @RequireAdmin('MERCHANTS_MANAGE')
  @Post('stores/:id/logo')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  logo(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.catalog.uploadStoreImage(a.userId, id, 'logo', file?.buffer);
  }

  @RequireAdmin('MERCHANTS_MANAGE')
  @Post('stores/:id/images')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  image(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.catalog.uploadStoreImage(a.userId, id, 'gallery', file?.buffer);
  }

  @RequireAdmin('MERCHANTS_MANAGE')
  @Delete('stores/:id/images/:imageId')
  @HttpCode(204)
  async deleteImage(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    await this.catalog.deleteStoreImage(a.userId, id, imageId);
  }

  @RequireAdmin('MERCHANTS_MANAGE')
  @Post('stores/:id/branches')
  @HttpCode(201)
  @DocBody(branchSchema)
  createBranch(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(branchSchema) body: z.infer<typeof branchSchema>, @Req() req: AppRequest) {
    return this.catalog.createBranch(a.userId, id, body, req.requestId);
  }

  @RequireAdmin('MERCHANTS_MANAGE')
  @Patch('branches/:id')
  @DocBody(branchSchema.partial())
  updateBranch(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(branchSchema.partial()) body: Partial<z.infer<typeof branchSchema>>, @Req() req: AppRequest) {
    return this.catalog.updateBranch(a.userId, id, body, req.requestId);
  }

  @RequireAdmin('MERCHANTS_MANAGE')
  @Post('branches/:id/status')
  @HttpCode(204)
  @DocBody(statusChangeSchema)
  async branchStatus(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(statusChangeSchema) body: z.infer<typeof statusChangeSchema>, @Req() req: AppRequest) {
    await this.catalog.setBranchStatus(a.userId, id, body.status, body.reason, req.requestId);
  }

  @RequireAdmin('OFFERS_MANAGE')
  @Get('stores/:id/offers')
  offers(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.offers(id);
  }

  @RequireAdmin('OFFERS_MANAGE')
  @Post('stores/:id/offers')
  @HttpCode(201)
  @DocBody(offerSchema)
  publishOffer(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(offerSchema) body: z.infer<typeof offerSchema>, @Req() req: AppRequest) {
    return this.catalog.publishOffer(a.userId, id, body, req.requestId);
  }

  @RequireAdmin('OFFERS_MANAGE')
  @Post('stores/:id/offers/deactivate')
  @HttpCode(204)
  @DocBody(reasonSchema)
  async deactivateOffer(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(reasonSchema) body: z.infer<typeof reasonSchema>, @Req() req: AppRequest) {
    await this.catalog.deactivateOffer(a.userId, id, body.reason, req.requestId);
  }

  // ---------------------------------------------------------------- invitations
  @RequireAdmin()
  @Post('invitations')
  @HttpCode(201)
  @DocBody(inviteSchema)
  async invite(@Auth() a: AuthContext, @ZBody(inviteSchema) body: z.infer<typeof inviteSchema>, @Req() req: AppRequest) {
    return this.catalog.invite(a.userId, body, await this.perms(a.userId), req.requestId);
  }

  @RequireAdmin('MERCHANTS_MANAGE')
  @Delete('invitations/:id')
  @HttpCode(204)
  async revokeInvite(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.catalog.revokeInvitation(a.userId, id);
  }

  // ---------------------------------------------------------------- redemptions
  @RequireAdmin('REDEMPTIONS_VIEW')
  @Get('redemptions')
  @DocQuery(adminRedemptionsQuerySchema)
  listRedemptions(@ZQuery(adminRedemptionsQuerySchema) q: z.infer<typeof adminRedemptionsQuerySchema>) {
    return this.reports.redemptions(q);
  }

  @RequireAdmin('REDEMPTIONS_VIEW')
  @Get('redemptions/export.csv')
  @DocQuery(adminRedemptionsQuerySchema)
  async exportCsv(@Auth() a: AuthContext, @ZQuery(adminRedemptionsQuerySchema) q: z.infer<typeof adminRedemptionsQuerySchema>, @Res() res: Response, @Req() req: AppRequest) {
    const csv = await this.reports.exportCsv(q);
    await this.audit.log({ actorUserId: a.userId, action: 'redemptions.exported', entityType: 'redemption', after: { filters: q }, requestId: req.requestId });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="redemptions.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }

  @RequireAdmin('REDEMPTIONS_VIEW')
  @Get('redemptions/:id')
  redemption(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.redemption(id);
  }

  @RequireAdmin('REDEMPTIONS_VOID')
  @Post('redemptions/:id/void')
  @HttpCode(200)
  @DocBody(reasonSchema)
  void(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string, @ZBody(reasonSchema) body: z.infer<typeof reasonSchema>, @Req() req: AppRequest) {
    return this.redemptions.voidRedemption(a.userId, id, body.reason, req.requestId);
  }

  // ---------------------------------------------------------------- notifications
  @RequireAdmin('NOTIFICATIONS_SEND')
  @Get('broadcasts')
  broadcastsList() {
    return this.broadcasts.list();
  }

  @RequireAdmin('NOTIFICATIONS_SEND')
  @Post('broadcasts/preview')
  @HttpCode(200)
  @DocBody(previewSchema)
  preview(@ZBody(previewSchema) body: z.infer<typeof previewSchema>) {
    return this.broadcasts.preview(body.audience, body.marketing);
  }

  @RequireAdmin('NOTIFICATIONS_SEND')
  @Post('broadcasts')
  @HttpCode(201)
  @DocBody(broadcastSchema)
  createBroadcast(@Auth() a: AuthContext, @ZBody(broadcastSchema) body: z.infer<typeof broadcastSchema>) {
    return this.broadcasts.create(a.userId, body);
  }

  @RequireAdmin('NOTIFICATIONS_SEND')
  @Post('broadcasts/:id/schedule')
  @HttpCode(200)
  schedule(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.schedule(a.userId, id);
  }

  @RequireAdmin('NOTIFICATIONS_SEND')
  @Post('broadcasts/:id/cancel')
  @HttpCode(204)
  async cancelBroadcast(@Auth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.broadcasts.cancel(a.userId, id);
  }

  // ---------------------------------------------------------------- settings
  @RequireAdmin('SETTINGS_MANAGE')
  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  /** Changing the time zone or limits affects future business dates only; every change is audited with a reason. */
  @RequireAdmin('SETTINGS_MANAGE')
  @Patch('settings')
  @DocBody(settingsSchema)
  async updateSettings(@Auth() a: AuthContext, @ZBody(settingsSchema) body: z.infer<typeof settingsSchema>, @Req() req: AppRequest) {
    const { reason, ...patch } = body;
    const { before, after } = await this.settings.update(patch, a.userId);
    await this.audit.log({ actorUserId: a.userId, action: 'settings.updated', entityType: 'settings', entityId: 'platform', reason, before, after, requestId: req.requestId });
    return after;
  }
}
