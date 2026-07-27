import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import { api, type Job } from "@/lib/api";
import { startVisibleInterval } from "@/lib/polling";
import { isParallelExecutionEnabled } from "@/lib/parallel-execution";
import { useDashboardStore } from "@/store/dashboard-store";
import { normalizeUrl, validateUrl } from "@/lib/url-validation";
import { useScanStore } from "@/store/scan-store";

export type ExecStatus = "idle" | "running" | "success" | "failed" | "cancelled";
export type ExecSource =
  | "quick_actions"
  | "ui_test"
  | "seo_test"
  | "sitemap_check"
  | "image_audit"
  | "security_audit"
  | "visual_twin"
  | null;

export type ModuleJobSlice = {
  status: ExecStatus;
  source: ExecSource;
  jobId: string | null;
  currentPage: number;
  totalPages: number;
  currentUrl: string;
  progress: number;
  message: string;
  jobStatus: string | null;
  job: Job | null;
  logsOpen: boolean;
  isCancelling: boolean;
  successMessage: string;
};

type StartJobParams = {
  moduleId: string;
  url: string;
  options?: Record<string, unknown>;
  source: ExecSource;
  successMessage?: string;
};

type ExecutionStore = {
  moduleJobs: Record<string, ModuleJobSlice>;
  drawerModuleId: string | null;
  startJob: (params: StartJobParams) => Promise<void>;
  cancelJob: (moduleId?: string) => Promise<void>;
  resumeActive: () => Promise<void>;
  setLogsOpen: (open: boolean, moduleId?: string) => void;
  setDrawerModule: (moduleId: string | null) => void;
  reset: (moduleId?: string) => void;
};

const JOB_POLL_MS = 5000;
const PARALLEL = isParallelExecutionEnabled();

const IDLE_MODULE_SLICE: ModuleJobSlice = {
  status: "idle",
  source: null,
  jobId: null,
  currentPage: 0,
  totalPages: 0,
  currentUrl: "",
  progress: 0,
  message: "",
  jobStatus: null,
  job: null,
  logsOpen: false,
  isCancelling: false,
  successMessage: "",
};

const moduleWatchers = new Map<string, { unsub: () => void; stopPoll: () => void }>();

function idleModuleSlice(): ModuleJobSlice {
  return { ...IDLE_MODULE_SLICE };
}

function getModuleSlice(state: ExecutionStore, moduleId: string): ModuleJobSlice {
  return state.moduleJobs[moduleId] ?? IDLE_MODULE_SLICE;
}

function patchModuleJob(
  state: ExecutionStore,
  moduleId: string,
  patch: Partial<ModuleJobSlice>
): Record<string, ModuleJobSlice> {
  const prev = getModuleSlice(state, moduleId);
  return {
    ...state.moduleJobs,
    [moduleId]: { ...prev, ...patch },
  };
}

function stopWatchingModule(moduleId: string) {
  const watcher = moduleWatchers.get(moduleId);
  if (!watcher) return;
  watcher.unsub();
  watcher.stopPoll();
  moduleWatchers.delete(moduleId);
}

function stopAllWatching() {
  for (const moduleId of moduleWatchers.keys()) {
    stopWatchingModule(moduleId);
  }
}

function mapJobStatus(status: string): ExecStatus {
  if (status === "pending" || status === "running") return "running";
  if (status === "completed") return "success";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "idle";
}

function extractJobFields(job: Job) {
  const currentUrl = job.currentUrl ?? job.executionState?.currentUrl ?? job.url;
  return {
    job,
    jobId: job.id,
    currentPage: job.currentPage ?? job.executionState?.currentPage ?? 0,
    totalPages: job.totalPages ?? job.executionState?.totalPages ?? 0,
    currentUrl,
    progress: job.progress ?? job.executionState?.progressPercent ?? 0,
    message: job.message ?? "",
    jobStatus: job.status,
  };
}

function anyJobRunning(state: ExecutionStore): boolean {
  return Object.values(state.moduleJobs).some(
    (slice) => slice.status === "running" || slice.isCancelling
  );
}

function isModuleRunning(state: ExecutionStore, moduleId: string): boolean {
  const slice = getModuleSlice(state, moduleId);
  return slice.status === "running" || slice.isCancelling;
}

function watchJob(
  moduleId: string,
  jobId: string,
  get: () => ExecutionStore,
  set: (partial: Partial<ExecutionStore> | ((state: ExecutionStore) => Partial<ExecutionStore>)) => void
) {
  stopWatchingModule(moduleId);

  const applyJob = (raw: Job) => {
    const status = mapJobStatus(raw.status);
    set((state) => ({
      moduleJobs: patchModuleJob(state, moduleId, {
        ...extractJobFields(raw),
        status,
        isCancelling: false,
      }),
    }));

    if (["completed", "failed", "cancelled"].includes(raw.status)) {
      stopWatchingModule(moduleId);
      if (raw.status === "completed" && raw.reportAvailable !== true) {
        setTimeout(() => {
          api
            .getJob(moduleId, jobId)
            .then(({ job: fresh }) => {
              if (fresh?.reportAvailable) {
                set((state) => ({
                  moduleJobs: patchModuleJob(state, moduleId, {
                    ...extractJobFields(fresh),
                    status: mapJobStatus(fresh.status),
                  }),
                }));
              }
            })
            .catch(() => {});
        }, 1200);
      }
      useDashboardStore.getState().bumpRefresh();
      const slice = getModuleSlice(get(), moduleId);
      if (raw.status === "completed") {
        toast.success(slice.successMessage || "Test completed successfully");
      } else if (raw.status === "failed" && slice.source) {
        toast.error(raw.error || "Test failed due to server error");
      } else if (raw.status === "cancelled" && slice.source) {
        toast.info("Test cancelled");
      }
    }
  };

  const poll = async () => {
    try {
      const { job: j } = await api.getJob(moduleId, jobId);
      applyJob(j);
    } catch {
      /* ignore transient poll errors */
    }
  };

  const unsub = api.subscribeJobEvents(moduleId, jobId, applyJob);
  const stopPoll = startVisibleInterval(poll, JOB_POLL_MS);
  moduleWatchers.set(moduleId, { unsub, stopPoll });
  void poll();
}

const moduleJobSelectors = new Map<string, (state: ExecutionStore) => ModuleJobSlice>();

/** Stable selector reference per moduleId (safe for useSyncExternalStore). */
export function selectModuleJob(moduleId: string) {
  let selector = moduleJobSelectors.get(moduleId);
  if (!selector) {
    selector = (state: ExecutionStore) => getModuleSlice(state, moduleId);
    moduleJobSelectors.set(moduleId, selector);
  }
  return selector;
}

/** Imperative helper — not for React subscriptions. */
export function getRunningModuleJobs(state: ExecutionStore) {
  return Object.entries(state.moduleJobs).filter(
    ([, slice]) => slice.status === "running" || slice.isCancelling
  );
}

export function selectAnyJobRunning(state: ExecutionStore) {
  return anyJobRunning(state);
}

export const useExecutionStore = create<ExecutionStore>((set, get) => ({
  moduleJobs: {},
  drawerModuleId: null,

  setDrawerModule: (moduleId) => set({ drawerModuleId: moduleId }),

  setLogsOpen: (open, moduleId) => {
    const target = moduleId || get().drawerModuleId;
    if (!target) return;
    set((state) => ({
      moduleJobs: patchModuleJob(state, target, { logsOpen: open }),
    }));
  },

  resumeActive: async () => {
    if (!PARALLEL && anyJobRunning(get())) return;

    try {
      const { jobs } = await api.getActiveJobs();
      const active = (jobs || []).filter((j) => ["pending", "running"].includes(j.status));
      if (!active.length) return;

      for (const job of active) {
        const moduleId = job.moduleId;
        if (!PARALLEL && anyJobRunning(get())) break;
        if (isModuleRunning(get(), moduleId)) continue;

        set((state) => ({
          drawerModuleId: state.drawerModuleId || moduleId,
          moduleJobs: patchModuleJob(state, moduleId, {
            ...extractJobFields(job),
            status: "running",
            source: null,
            logsOpen: true,
            isCancelling: false,
            successMessage: "Test completed successfully",
          }),
        }));
        watchJob(moduleId, job.id, get, set);
      }
    } catch {
      /* ignore resume errors */
    }
  },

  reset: (moduleId) => {
    if (moduleId) {
      stopWatchingModule(moduleId);
      set((state) => {
        const next = { ...state.moduleJobs };
        delete next[moduleId];
        return {
          moduleJobs: next,
          drawerModuleId: state.drawerModuleId === moduleId ? null : state.drawerModuleId,
        };
      });
      return;
    }

    stopAllWatching();
    set({ moduleJobs: {}, drawerModuleId: null });
  },

  startJob: async ({ moduleId, url, options, source, successMessage }) => {
    const urlError = validateUrl(url);
    if (urlError) {
      toast.error(urlError);
      return;
    }
    const cleanUrl = normalizeUrl(url);

    if (isModuleRunning(get(), moduleId)) {
      toast.error(`A test is already running for ${moduleId}`);
      return;
    }

    if (!PARALLEL) {
      if (anyJobRunning(get())) {
        toast.error("An execution is already in progress");
        return;
      }
      const scan = useScanStore.getState();
      if (scan.status === "running" || scan.isCancelling) {
        toast.error("A keyword or link scan is already in progress");
        return;
      }
      stopAllWatching();
    } else {
      const scan = useScanStore.getState();
      if (
        (scan.moduleId === "keyword-check" || scan.moduleId === "error-check") &&
        scan.moduleId === moduleId &&
        (scan.status === "running" || scan.isCancelling)
      ) {
        toast.error("A scan is already in progress for this module");
        return;
      }
    }

    const toastId = toast.loading("Running test…");

    set((state) => ({
      drawerModuleId: moduleId,
      moduleJobs: patchModuleJob(state, moduleId, {
        ...idleModuleSlice(),
        status: "running",
        source,
        currentUrl: cleanUrl,
        logsOpen: true,
        successMessage: successMessage || "Test completed successfully",
      }),
    }));

    try {
      const { job: created } = await api.startJob(moduleId, { url: cleanUrl, options });
      set((state) => ({
        moduleJobs: patchModuleJob(state, moduleId, {
          ...extractJobFields(created),
          status: "running",
          source,
          logsOpen: true,
          successMessage: successMessage || "Test completed successfully",
        }),
      }));
      watchJob(moduleId, created.id, get, set);
      toast.dismiss(toastId);
    } catch (err) {
      stopWatchingModule(moduleId);
      set((state) => {
        const next = { ...state.moduleJobs };
        delete next[moduleId];
        return {
          moduleJobs: next,
          drawerModuleId: state.drawerModuleId === moduleId ? null : state.drawerModuleId,
        };
      });
      toast.dismiss(toastId);
      const msg = (err as Error).message || "Test failed due to server error";
      toast.error(msg.includes("API") ? msg : `Test failed: ${msg}`);
    }
  },

  cancelJob: async (moduleId) => {
    const targetModuleId = moduleId || get().drawerModuleId;
    if (!targetModuleId) return;

    const slice = getModuleSlice(get(), targetModuleId);
    if (!slice.jobId || slice.isCancelling || slice.status !== "running") return;

    set((state) => ({
      moduleJobs: patchModuleJob(state, targetModuleId, { isCancelling: true }),
    }));

    try {
      await api.cancelExecution(targetModuleId, slice.jobId);
      stopWatchingModule(targetModuleId);
      try {
        const { job: j } = await api.getJob(targetModuleId, slice.jobId);
        set((state) => ({
          moduleJobs: patchModuleJob(state, targetModuleId, {
            ...extractJobFields(j),
            status: "cancelled",
            isCancelling: false,
          }),
        }));
      } catch {
        get().reset(targetModuleId);
      }
      useDashboardStore.getState().bumpRefresh();
    } catch (err) {
      toast.error((err as Error).message || "Failed to cancel execution");
      get().reset(targetModuleId);
    }
  },
}));

/** Subscribe to one module's job slice with shallow equality. */
export function useModuleJob(moduleId: string) {
  return useExecutionStore(useShallow(selectModuleJob(moduleId)));
}

/** Running job count — primitive selector, safe for useSyncExternalStore. */
export function useRunningModuleCount() {
  return useExecutionStore((state) => {
    let count = 0;
    for (const slice of Object.values(state.moduleJobs)) {
      if (slice.status === "running" || slice.isCancelling) count++;
    }
    return count;
  });
}