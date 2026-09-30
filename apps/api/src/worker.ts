import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Queue, Worker } from 'bullmq';
import { WorkerModule } from './app.module';
import { loadConfig } from './config';
import { logger } from './common/logger';
import { RedisService } from './common/redis';
import { NotificationsService, PUSH_QUEUE } from './notifications/notifications.service';
import { OutboxProcessor } from './notifications/outbox.processor';

/**
 * Background worker:
 *  - drains the transactional outbox (after-commit side effects),
 *  - delivers push notifications from the BullMQ queue with retry/backoff,
 *  - runs periodic idempotent jobs (scheduled broadcasts, expiry reminders, opt-in daily summary).
 * PostgreSQL remains the source of truth for eligibility; Redis only carries jobs.
 */
async function main(): Promise<void> {
  const c = loadConfig();
  if (!c.REDIS_URL) throw new Error('REDIS_URL is required for the worker');
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error', 'warn'] });
  app.enableShutdownHooks();
  const outbox = app.get(OutboxProcessor);
  const notifications = app.get(NotificationsService);
  const connection = app.get(RedisService).get()!;

  const pushWorker = new Worker(PUSH_QUEUE, async (job) => notifications.deliver(job.data.deliveryId as string), { connection, concurrency: 10 });
  pushWorker.on('failed', (job, err) => logger.warn({ jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, 'push job failed'));

  const schedQueue = new Queue('scheduled', { connection });
  await schedQueue.upsertJobScheduler('minutely', { every: 60_000 }, { name: 'tick' });
  await schedQueue.upsertJobScheduler('daily-summary', { pattern: '0 9 * * *', tz: c.DEFAULT_TIMEZONE }, { name: 'daily-summary' });
  const schedWorker = new Worker(
    'scheduled',
    async (job) => {
      if (job.name === 'tick') await outbox.runScheduled();
      if (job.name === 'daily-summary') await outbox.dailySummaries();
    },
    { connection, concurrency: 1 },
  );

  let stopping = false;
  const loop = async () => {
    while (!stopping) {
      try {
        const n = await outbox.processBatch(50);
        if (n === 0) await new Promise((r) => setTimeout(r, 1000));
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'outbox loop error');
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  void loop();
  logger.info('worker started');

  const shutdown = async () => {
    stopping = true;
    await Promise.allSettled([pushWorker.close(), schedWorker.close(), schedQueue.close()]);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  logger.fatal({ err: (e as Error).message }, 'worker failed to start');
  process.exit(1);
});
