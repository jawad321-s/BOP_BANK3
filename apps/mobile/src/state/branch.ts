import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMerchantWorkspace } from './auth';

/** Selected branch for the cashier (only branches the API returned for this membership are selectable). */
export function useBranch() {
  const ws = useMerchantWorkspace();
  const branches = ws?.stores.flatMap((s) => s.branches.map((b) => ({ ...b, storeId: s.id, storeName: s.name }))) ?? [];
  const key = `bitaqati.branch.${ws?.membershipId ?? 'none'}`;
  const [branchId, setBranchIdState] = useState<string | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(key).then((v) => {
      const valid = branches.find((b) => b.id === v);
      setBranchIdState(valid ? valid.id : branches[0]?.id ?? null);
    });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const setBranchId = (id: string) => {
    setBranchIdState(id);
    void AsyncStorage.setItem(key, id);
  };
  return { ws, branches, branchId, branch: branches.find((b) => b.id === branchId) ?? null, setBranchId };
}
