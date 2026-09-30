import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import helmet from 'helmet';
import { config } from './config';

export function configureApp(app: NestExpressApplication): void {
  const c = config();
  if (c.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.useBodyParser('json', { limit: '100kb' });
  const origins = c.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  // The mobile app does not need CORS. The admin web calls the API server-to-server via its BFF.
  app.enableCors({ origin: origins.length ? origins : false, credentials: false });
  app.enableShutdownHooks();
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const cfg = new DocumentBuilder()
    .setTitle('Bitaqati API')
    .setDescription(
      'Digital discount card platform. Money in integer minor units (agorot), rates in basis points. ' +
        'Errors: { error: { code, message, requestId, details? } } with stable codes.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, cfg);
}
