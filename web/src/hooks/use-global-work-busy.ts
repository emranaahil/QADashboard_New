import { useExecutionStore } from "@/store/execution-store";
import { useScanStore } from "@/store/scan-store";

/** True while any QA job or scan is running or being cancelled (header shows Running). */
export function useGlobalWorkBusy(): boolean {
  const jobBusy = useExecutionStore((s) => s.status === "running" || s.isCancelling);
  const scanBusy = useScanStore((s) => s.status === "running" || s.isCancelling);
  return jobBusy || scanBusy;
}