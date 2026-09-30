import { Injectable, OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';
import { config } from '../config';

/** Lazily-created shared Redis connection (null when REDIS_URL is not configured outside production). */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private client: IORedis | null = null;

  get(): IORedis | null {
    const url = config().REDIS_URL;
    if (!url) return null;
    if (!this.client) this.client = new IORedis(url, { maxRetriesPerRequest: null, lazyConnect: false });
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }
}
