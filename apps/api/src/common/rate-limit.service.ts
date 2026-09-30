import { Injectable } from '@nestjs/common';
import { AppError } from './errors';
import { RedisService } from './redis';
import { logger } from './logger';

/**
 * Fixed-window rate limiter. Redis-backed when available (shared across API instances);
 * in-memory fallback is only used without REDIS_URL (development/test — production requires Redis).
 */
@Injectable()
export class RateLimitService {
  private memory = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<void> {
    const count = await this.increment(`rl:${key}`, windowSeconds);
    if (count > limit) {
      logger.warn({ rateLimitKey: key.split(':')[0], count }, 'rate limit exceeded');
      throw new AppError('RATE_LIMITED', { retryAfterSeconds: windowSeconds });
    }
  }

  async reset(key: string): Promise<void> {
    this.memory.delete(`rl:${key}`);
    const r = this.redis.get();
    if (r) await r.del(`rl:${key}`);
  }

  clearMemory(): void {
    this.memory.clear();
  }

  private async increment(key: string, windowSeconds: number): Promise<number> {
    const r = this.redis.get();
    if (r) {
      try {
        const res = await r.multi().incr(key).expire(key, windowSeconds, 'NX').exec();
        return Number(res?.[0]?.[1] ?? 0);
      } catch (e) {
        logger.error({ err: (e as Error).message }, 'rate limiter redis failure; falling back to memory');
      }
    }
    const now = Date.now();
    const cur = this.memory.get(key);
    if (!cur || cur.resetAt <= now) {
      this.memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return 1;
    }
    cur.count += 1;
    return cur.count;
  }
}
