import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildOpenApi, configureApp } from './bootstrap';
import { loadConfig } from './config';
import { logger } from './common/logger';

async function main(): Promise<void> {
  const c = loadConfig(); // fails fast on missing production configuration
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'], bodyParser: false });
  configureApp(app);
  if (!c.isProduction) SwaggerModule.setup('docs', app, buildOpenApi(app));
  await app.listen(c.PORT);
  logger.info({ port: c.PORT, appEnv: c.APP_ENV }, 'api listening');
}

main().catch((e) => {
  logger.fatal({ err: (e as Error).message }, 'api failed to start');
  process.exit(1);
});
