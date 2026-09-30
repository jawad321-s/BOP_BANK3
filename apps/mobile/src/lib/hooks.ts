import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { onlineManager, focusManager, useQueryClient } from '@tanstack/react-query';

/** Refetch everything when the app returns to the foreground (never trust cached eligibility). */
export function useForegroundRefresh() {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
    return () => sub.remove();
  }, []);
}

/** Invalidates queries when the server-announced business day rolls over (local midnight in the platform zone). */
export function useDayRollover(nextResetAt: string | undefined, keys: string[][]) {
  const qc = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!nextResetAt) return;
    const ms = Date.parse(nextResetAt) - Date.now() + 2000;
    if (ms <= 0 || ms > 36 * 3600_000) return;
    timer.current = setTimeout(() => keys.forEach((k) => qc.invalidateQueries({ queryKey: k })), ms);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [nextResetAt, qc, keys]);
}

export function useIsOnline(): boolean {
  return onlineManager.isOnline();
}
