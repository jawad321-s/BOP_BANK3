import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuditService } from './common/audit.service';
import { AuthGuard } from './common/auth.guard';
import { Clock } from './common/clock';
import { AllExceptionsFilter, RequestContextMiddleware } from './common/http';
import { MailService } from './common/mail.service';
import { PrismaService } from './common/prisma.service';
import { RateLimitService } from './common/rate-limit.service';
import { RedisService } from './common/redis';
import { SettingsService } from './common/settings.service';
import { StorageService } from './common/storage.service';
import { MembershipService } from './domain/membership.service';
import { MerchantAccessService } from './domain/merchant-access.service';
import { RedemptionService } from './domain/redemption.service';
import { AdminCatalogService } from './modules/admin-catalog.service';
import { AdminReportsService } from './modules/admin-reports.service';
import { AdminUsersService } from './modules/admin-users.service';
import { AdminController } from './modules/admin.controller';
import { AuthController } from './modules/auth.controller';
import { AuthService } from './modules/auth.service';
import { MeController } from './modules/me.controller';
import { MeService } from './modules/me.service';
import { MerchantController } from './modules/merchant.controller';
import { MerchantService } from './modules/merchant.service';
import { PublicController } from './modules/public.controller';
import { StoresService } from './modules/stores.service';
import { BroadcastService } from './notifications/broadcast.service';
import { NotificationsService } from './notifications/notifications.service';
import { OutboxProcessor } from './notifications/outbox.processor';
import { PushProvider } from './notifications/push.provider';

export const PROVIDERS = [
  PrismaService,
  Clock,
  RedisService,
  RateLimitService,
  SettingsService,
  AuditService,
  MailService,
  StorageService,
  MembershipService,
  MerchantAccessService,
  RedemptionService,
  AuthService,
  StoresService,
  MeService,
  MerchantService,
  AdminUsersService,
  AdminCatalogService,
  AdminReportsService,
  PushProvider,
  NotificationsService,
  BroadcastService,
  OutboxProcessor,
];

/** Modular monolith: one deployable API with clear domain services. */
@Module({
  controllers: [PublicController, AuthController, MeController, MerchantController, AdminController],
  providers: [...PROVIDERS, { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}

/** Worker process: no HTTP controllers, same domain services. */
@Module({ providers: PROVIDERS })
export class WorkerModule {}
