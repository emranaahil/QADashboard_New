import {
  useExecutionStore,
  selectAnyJobRunning,
  useModuleJob,
} from "@/store/execution-store";
import { useScanStore } from "@/store/scan-store";
import { isParallelExecutionEnabled } from "@/lib/parallel-execution";

/** True while any QA job or scan is running (header shows Running). */
export function useGlobalWorkBusy(): boolean {
  const jobBusy = useExecutionStore(selectAnyJobRunning);
  const scanBusy = useScanStore((s) => s.status === "running" || s.isCancelling);
  return jobBusy || scanBusy;
}

/** True while a specific job module is running. Use to lock only that module's form in local parallel mode. */
export function useModuleWorkBusy(moduleId?: string): boolean {
  const parallel = isParallelExecutionEnabled();
  const slice = useModuleJob(moduleId ?? "__none__");
  const globalJobBusy = useExecutionStore(selectAnyJobRunning);
  const scanRunning = useScanStore((s) => s.status === "running" || s.isCancelling);
  const scanModuleId = useScanStore((s) => s.moduleId);

  const moduleBusy =
    moduleId && moduleId !== "__none__"
      ? slice.status === "running" || slice.isCancelling
      : false;

  const scanBusy =
    moduleId === "keyword-check" || moduleId === "error-check"
      ? scanRunning && scanModuleId === moduleId
      : !moduleId
        ? scanRunning
        : false;

  if (parallel && moduleId) {
    return moduleBusy || scanBusy;
  }

  return globalJobBusy || scanRunning;
}