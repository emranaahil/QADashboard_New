import { create } from "zustand";
import { toast } from "sonner";
import { api, type Job } from "@/lib/api";
import { startVisibleInterval } from "@/lib/polling";
import { useDashboardStore } from "@/store/dashboard-store";
import { normalizeUrl, validateUrl } from "@/lib/url-validation";
import { useScanStore } from "@/store/scan-store";

export type ExecStatus = "idle" | "running" | "success" | "failed" | "cancelled";
export type ExecSource = "quick_actions" | "ui_test" | "seo_test" | null;

type StartJobParams = {
  moduleId: string;
  url: string;
  options?: Record<string, unknown>;
  source: ExecSource;
  successMessage?: string;
};

type ExecutionStore = {
  status: ExecStatus;
  source: ExecSource;
  moduleId: string | null;
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
  startJob: (params: StartJobParams) => Promise<void>;
  cancelJob: () => Promise<void>;
  resumeActive: () => Promise<void>;
  setLogsOpen: (open: boolean) => void;
  reset: () => void;
};

let unsubRef: (() => void) | null = null;
let stopPollRef: (() => void) | null = null;
const JOB_POLL_MS = 5000;

const IDLE_STATE = {
  status: "idle" as ExecStatus,
  source: null as ExecSource,
  moduleId: null,
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

function stopWatching() {
  unsubRef?.();
  unsubRef = null;
  stopPollRef?.();
  stopPollRef = null;
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
    moduleId: job.moduleId,
    jobId: job.id,
    currentPage: job.currentPage ?? job.executionState?.currentPage ?? 0,
    totalPages: job.totalPages ?? job.executionState?.totalPages ?? 0,
    currentUrl,
    progress: job.progress ?? job.executionState?.progressPercent ?? 0,
    message: job.message ?? "",
    jobStatus: job.status,
  };
}

function watchJob(moduleId: string, jobId: string, get: () => ExecutionStore, set: (p: Partial<ExecutionStore>) => void) {
  stopWatching();

  const applyJob = (raw: Job) => {
    const j = raw;
    const status = mapJobStatus(j.status);
    set({ ...extractJobFields(j), status, isCancelling: false });

    if (["completed", "failed", "cancelled"].includes(j.status)) {
      stopWatching();
      useDashboardStore.getState().bumpRefresh();
      const { successMessage, source } = get();
      if (j.status === "completed") {
        toast.success(successMessage || "Test completed successfully");
      } else if (j.status === "failed" && source) {
        toast.error(j.error || "Test failed due to server error");
      } else if (j.status === "cancelled" && source) {
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

  unsubRef = api.subscribeJobEvents(moduleId, jobId, applyJob);

  stopPollRef = startVisibleInterval(poll, JOB_POLL_MS);
  void poll();
}

export const useExecutionStore = create<ExecutionStore>((set, get) => ({
  ...IDLE_STATE,

  setLogsOpen: (open) => set({ logsOpen: open }),

  resumeActive: async () => {
    const { status } = get();
    if (status === "running") return;

    try {
      const { job: activeJob } = await api.getActiveJob();
      const job = activeJob;
      if (!job || !["pending", "running"].includes(job.status)) return;

      set({
        ...extractJobFields(job),
        status: "running",
        source: null,
        logsOpen: true,
        isCancelling: false,
        successMessage: "Test completed successfully",
      });
      watchJob(job.moduleId, job.id, get, set);
    } catch {
      /* ignore resume errors */
    }
  },

  reset: () => {
    stopWatching();
    set({ ...IDLE_STATE });
  },

  startJob: async ({ moduleId, url, options, source, successMessage }) => {
    const urlError = validateUrl(url);
    if (urlError) {
      toast.error(urlError);
      return;
    }
    const cleanUrl = normalizeUrl(url);

    const { status, isCancelling } = get();
    if (status === "running" || isCancelling) {
      toast.error("An execution is already in progress");
      return;
    }
    const scan = useScanStore.getState();
    if (scan.status === "running" || scan.isCancelling) {
      toast.error("A keyword or link scan is already in progress");
      return;
    }

    stopWatching();
    const toastId = toast.loading("Running test…");

    set({
      ...IDLE_STATE,
      status: "running",
      source,
      moduleId,
      currentUrl: cleanUrl,
      logsOpen: true,
      successMessage: successMessage || "Test completed successfully",
    });

    try {
      const { job: created } = await api.startJob(moduleId, { url: cleanUrl, options });
      set({ ...extractJobFields(created), status: "running", source, logsOpen: true });
      watchJob(moduleId, created.id, get, set);
      toast.dismiss(toastId);
    } catch (err) {
      stopWatching();
      set({ ...IDLE_STATE });
      toast.dismiss(toastId);
      const msg = (err as Error).message || "Test failed due to server error";
      toast.error(msg.includes("API") ? msg : `Test failed: ${msg}`);
    }
  },

  cancelJob: async () => {
    const { moduleId, jobId, isCancelling, status } = get();
    if (!moduleId || !jobId || isCancelling || status !== "running") return;

    set({ isCancelling: true });

    try {
      await api.cancelExecution(moduleId, jobId);
      stopWatching();
      try {
        const { job: j } = await api.getJob(moduleId, jobId);
        set({ ...extractJobFields(j), status: "cancelled", isCancelling: false });
      } catch {
        set({ ...IDLE_STATE });
      }
      useDashboardStore.getState().bumpRefresh();
    } catch (err) {
      toast.error((err as Error).message || "Failed to cancel execution");
      set({ ...IDLE_STATE });
    }
  },
}));