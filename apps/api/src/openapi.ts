import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { buildOpenApi } from './bootstrap';

/** Writes docs/openapi.json from the live route table. Usage: pnpm --filter @bitaqati/api openapi */
async function main(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  const doc = buildOpenApi(app);
  const out = resolve(__dirname, '../../../docs/openapi.json');
  writeFileSync(out, JSON.stringify(doc, null, 2));
  await app.close();
  console.log(`wrote ${out} (${Object.keys(doc.paths).length} paths)`);
}
void main();
