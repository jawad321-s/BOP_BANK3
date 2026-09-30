import { Injectable } from '@nestjs/common';
import { config } from '../config';
import { logger } from '../common/logger';

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export type PushResult =
  | { status: 'SENT'; providerRef?: string }
  | { status: 'SIMULATED' }
  | { status: 'INVALID_TOKEN'; error: string }
  | { status: 'RETRY'; error: string }
  | { status: 'FAILED'; error: string };

/**
 * Push adapter.
 * - `expo`: Expo Push Service (which relays to APNs/FCM). Requires EXPO_ACCESS_TOKEN when enhanced security is on.
 * - `log`: development-only; returns SIMULATED and never claims delivery. Forbidden in production by config validation.
 */
@Injectable()
export class PushProvider {
  async send(msg: PushMessage): Promise<PushResult> {
    const c = config();
    if (c.PUSH_PROVIDER === 'log') {
      logger.info({ push: { title: msg.title } }, 'push SIMULATED (PUSH_PROVIDER=log, not delivered)');
      return { status: 'SIMULATED' };
    }
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(c.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${c.EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify({ to: msg.token, title: msg.title, body: msg.body, data: msg.data ?? {}, sound: 'default', priority: 'high' }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status >= 500 || res.status === 429) return { status: 'RETRY', error: `HTTP ${res.status}` };
      const json = (await res.json()) as { data?: { status: string; id?: string; message?: string; details?: { error?: string } }; errors?: Array<{ message: string }> };
      if (json.errors?.length) return { status: 'FAILED', error: json.errors[0].message };
      const d = json.data;
      if (d?.status === 'ok') return { status: 'SENT', providerRef: d.id };
      if (d?.details?.error === 'DeviceNotRegistered') return { status: 'INVALID_TOKEN', error: 'DeviceNotRegistered' };
      if (d?.details?.error === 'MessageRateExceeded') return { status: 'RETRY', error: 'MessageRateExceeded' };
      return { status: 'FAILED', error: d?.message ?? 'unknown' };
    } catch (e) {
      return { status: 'RETRY', error: (e as Error).message };
    }
  }
}
