import type { Tx } from './prisma.service';

export type OutboxEventType =
  | 'redemption.confirmed'
  | 'redemption.voided'
  | 'quote.created'
  | 'verification.requested'
  | 'membership.activated'
  | 'photo.reviewed'
  | 'account.deleted';

/** Write an outbox event inside the caller's transaction; it is dispatched only after commit. */
export async function enqueueOutbox(tx: Tx, type: OutboxEventType, payload: Record<string, unknown>, dedupeKey: string): Promise<void> {
  await tx.outboxEvent.upsert({
    where: { dedupeKey },
    create: { type, payload: payload as never, dedupeKey },
    update: {},
  });
}
