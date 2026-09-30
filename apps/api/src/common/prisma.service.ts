import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/** True for a unique-constraint violation, whether raised by Prisma or by raw SQL. */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') {
      if (!constraint) return true;
      return JSON.stringify(e.meta ?? {}).includes(constraint) || e.message.includes(constraint);
    }
    if (e.code === 'P2010') {
      const msg = JSON.stringify(e.meta ?? {}) + e.message;
      return msg.includes('23505') && (!constraint || msg.includes(constraint));
    }
  }
  const msg = e instanceof Error ? e.message : String(e);
  return (msg.includes('23505') || msg.includes('Unique constraint')) && (!constraint || msg.includes(constraint));
}

export function isSerializationFailure(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') return true;
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes('40001') || msg.includes('40P01') || msg.includes('deadlock');
}
