import { Injectable } from '@nestjs/common';
import type { Branch, Merchant, MerchantMembership, Store } from '@prisma/client';
import { AppError } from '../common/errors';
import { PrismaService, type Tx } from '../common/prisma.service';

export interface BranchAccess {
  membership: MerchantMembership;
  branch: Branch;
  store: Store;
  merchant: Merchant;
}

/**
 * Server-side merchant scoping. Every merchant endpoint resolves the caller's access from
 * memberships in the database — never from store/branch ids or roles supplied by the client.
 */
@Injectable()
export class MerchantAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async memberships(userId: string) {
    return this.prisma.merchantMembership.findMany({
      where: { userId, active: true, merchant: { status: { not: 'SUSPENDED' } } },
      include: {
        merchant: true,
        branches: { include: { branch: { include: { store: true } } } },
      },
    });
  }

  /** Branch ids the user may operate on (owner → all branches of the merchant; staff → assigned only). */
  async accessibleBranchIds(userId: string): Promise<{ branchIds: string[]; storeIds: string[]; ownerMerchantIds: string[] }> {
    const ms = await this.memberships(userId);
    const branchIds = new Set<string>();
    const storeIds = new Set<string>();
    const ownerMerchantIds: string[] = [];
    for (const m of ms) {
      if (m.role === 'OWNER') {
        ownerMerchantIds.push(m.merchantId);
        const branches = await this.prisma.branch.findMany({ where: { store: { merchantId: m.merchantId } }, select: { id: true, storeId: true } });
        branches.forEach((b) => {
          branchIds.add(b.id);
          storeIds.add(b.storeId);
        });
      } else {
        m.branches.forEach((mb) => {
          branchIds.add(mb.branchId);
          storeIds.add(mb.branch.storeId);
        });
      }
    }
    return { branchIds: [...branchIds], storeIds: [...storeIds], ownerMerchantIds };
  }

  /** Pass `db` when called inside a transaction so no second pool connection is needed. */
  async requireBranch(userId: string, branchId: string, db: Tx | PrismaService = this.prisma): Promise<BranchAccess> {
    const branch = await db.branch.findUnique({ where: { id: branchId }, include: { store: { include: { merchant: true } } } });
    if (!branch) throw new AppError('BRANCH_NOT_ASSIGNED');
    const membership = await db.merchantMembership.findUnique({
      where: { userId_merchantId: { userId, merchantId: branch.store.merchantId } },
      include: { branches: true },
    });
    if (!membership || !membership.active) throw new AppError('BRANCH_NOT_ASSIGNED');
    if (membership.role !== 'OWNER' && !membership.branches.some((b) => b.branchId === branchId)) throw new AppError('BRANCH_NOT_ASSIGNED');
    const { store } = branch;
    return { membership, branch, store, merchant: store.merchant };
  }

  assertOperational(a: Pick<BranchAccess, 'branch' | 'store' | 'merchant'>): void {
    if (a.merchant.status !== 'ACTIVE' || a.store.status !== 'ACTIVE' || a.branch.status !== 'ACTIVE') throw new AppError('STORE_UNAVAILABLE');
  }

  async requireOwner(userId: string, merchantId: string): Promise<MerchantMembership> {
    const m = await this.prisma.merchantMembership.findUnique({ where: { userId_merchantId: { userId, merchantId } } });
    if (!m || !m.active || m.role !== 'OWNER') throw new AppError('FORBIDDEN');
    return m;
  }
}
