import { useEffect } from "react";
import { useGlobalWorkBusy } from "@/hooks/use-global-work-busy";

export const HISTORY_START_DELAY_MS = 8000;

/**
 * Refresh history once after a job/scan starts so the new run appears in the list.
 * No repeated polling while the test is still running.
 */
export function useHistoryStartRefresh(onRefresh: () => void) {
  const globalBusy = useGlobalWorkBusy();

  useEffect(() => {
    if (!globalBusy) return;
    const timer = setTimeout(onRefresh, HISTORY_START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [globalBusy, onRefresh]);
}