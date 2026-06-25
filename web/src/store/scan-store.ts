import { create } from "zustand";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { startVisibleInterval } from "@/lib/polling";
import { useDashboardStore } from "@/store/dashboard-store";
import { normalizeUrl, validateUrl } from "@/lib/url-validation";
import { useExecutionStore } from "@/store/execution-store";

export type ScanModuleId = "keyword-check" | "error-check";
export type ScanStatus = "idle" | "running" | "success" | "failed" | "cancelled";

type ScanStore = {
  moduleId: ScanModuleId | null;
  scanId: string | null;
  status: ScanStatus;
  progress: number;
  message: string;
  isCancelling: boolean;
  errorMessage: string;
  failedScanId: string | null;
  urlsDiscovered: number;
  urlsProcessed: number;
  matchesFound: number;
  currentBatch: number;
  errorCount: number;
  currentUrl: string;
  startKeywordScan: (url: string, keywords: string[]) => Promise<void>;
  startErrorCheck: (url: string, options?: { maxUrls?: number; maxDepth?: number }) => Promise<void>;
  cancelScan: () => Promise<void>;
  resumeActive: () => Promise<void>;
  reset: () => void;
};

let stopPollRef: (() => void) | null = null;
const KEYWORD_POLL_MS = 4000;
const ERROR_POLL_MS = 4000;

const IDLE: Omit<
  ScanStore,
  "startKeywordScan" | "startErrorCheck" | "cancelScan" | "resumeActive" | "reset"
> = {
  moduleId: null,
  scanId: null,
  status: "idle",
  progress: 0,
  message: "",
  isCancelling: false,
  errorMessage: "",
  failedScanId: null,
  urlsDiscovered: 0,
  urlsProcessed: 0,
  matchesFound: 0,
  currentBatch: 0,
  errorCount: 0,
  currentUrl: "",
};

function stopPolling() {
  stopPollRef?.();
  stopPollRef = null;
}

function mapKeywordStatus(status: string): ScanStatus {
  if (status === "completed") return "success";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "running" || status === "starting") return "running";
  return "idle";
}

function mapErrorStatus(status?: string): ScanStatus {
  if (status === "done" || status === "completed") return "success";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "running") return "running";
  return "idle";
}

export const useScanStore = create<ScanStore>((set, get) => ({
  ...IDLE,

  reset: () => {
    stopPolling();
    set({ ...IDLE });
  },

  resumeActive: async () => {
    const { status } = get();
    if (status === "running") return;

    try {
      const active = await api.getActiveKeywordScan();
      if (active?.scanId) {
        set({
          moduleId: "keyword-check",
          scanId: active.scanId,
          status: "running",
          message: active.status || "Running…",
        });
        startKeywordPolling(active.scanId, get, set);
        return;
      }

      const errStatus = await api.getErrorCheckStatus();
      if (errStatus.status === "running") {
        set({
          moduleId: "error-check",
          scanId: errStatus.runId || "active",
          status: "running",
          message: "Checking pages…",
          urlsProcessed: errStatus.stats?.urlsProcessed || 0,
          errorCount: errStatus.stats?.errorCount || 0,
          currentUrl: errStatus.currentUrl || "",
        });
        startErrorPolling(get, set);
      }
    } catch {
      /* ignore resume errors */
    }
  },

  startKeywordScan: async (url, keywords) => {
    const urlError = validateUrl(url);
    if (urlError) {
      toast.error(urlError);
      return;
    }
    if (get().status === "running" || get().isCancelling) {
      toast.error("A scan is already in progress");
      return;
    }
    const job = useExecutionStore.getState();
    if (job.status === "running" || job.isCancelling) {
      toast.error("A UI or SEO test is already in progress");
      return;
    }

    stopPolling();
    const cleanUrl = normalizeUrl(url);
    set({
      ...IDLE,
      moduleId: "keyword-check",
      status: "running",
      message: "Starting scan…",
    });

    try {
      const { scanId } = await api.startKeywordScan(cleanUrl, keywords);
      set({ scanId, message: "Initializing…" });
      startKeywordPolling(scanId, get, set);
    } catch (err) {
      const msg = (err as Error).message || "Failed to start scan";
      set({ status: "failed", errorMessage: msg });
      toast.error(msg);
    }
  },

  startErrorCheck: async (url, options) => {
    const urlError = validateUrl(url);
    if (urlError) {
      toast.error(urlError);
      return;
    }
    if (get().status === "running" || get().isCancelling) {
      toast.error("A check is already in progress");
      return;
    }
    const job = useExecutionStore.getState();
    if (job.status === "running" || job.isCancelling) {
      toast.error("A UI or SEO test is already in progress");
      return;
    }

    stopPolling();
    const cleanUrl = normalizeUrl(url);
    set({
      ...IDLE,
      moduleId: "error-check",
      status: "running",
      message: "Starting check…",
    });

    try {
      const { runId } = await api.startErrorCheck(cleanUrl, options);
      set({ scanId: runId, message: "Checking pages…" });
      startErrorPolling(get, set);
    } catch (err) {
      const msg = (err as Error).message || "Failed to start check";
      set({ status: "failed", errorMessage: msg });
      toast.error(msg);
    }
  },

  cancelScan: async () => {
    const { moduleId, scanId, isCancelling, status } = get();
    if (!moduleId || status !== "running" || isCancelling) return;

    set({ isCancelling: true, message: "Cancelling…" });

    try {
      if (moduleId === "keyword-check" && scanId) {
        await api.cancelKeywordScan(scanId);
      } else if (moduleId === "error-check") {
        await api.cancelErrorCheck();
        for (let attempt = 0; attempt < 25; attempt += 1) {
          const data = await api.getErrorCheckStatus();
          if (data.status !== "running") break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      stopPolling();
      set({ status: "cancelled", isCancelling: false, message: "Cancelled" });
      useDashboardStore.getState().bumpRefresh();
      toast.info("Scan cancelled");
    } catch (err) {
      toast.error((err as Error).message || "Failed to cancel");
      set({ isCancelling: false });
    }
  },
}));

function startKeywordPolling(
  scanId: string,
  get: () => ScanStore,
  set: (p: Partial<ScanStore>) => void
) {
  stopPolling();

  const poll = async () => {
    try {
      const data = await api.getKeywordScanStatus(scanId);
      const stats = data.stats || {};
      const urlsDiscovered = stats.urlsDiscovered || 0;
      const urlsProcessed = stats.urlsProcessed || 0;
      const pct = urlsDiscovered
        ? Math.min(100, Math.round((urlsProcessed / urlsDiscovered) * 100))
        : 0;
      const mapped = mapKeywordStatus(data.status);

      set({
        moduleId: "keyword-check",
        scanId,
        status: mapped,
        urlsDiscovered,
        urlsProcessed,
        matchesFound: stats.matchesFound || 0,
        currentBatch: stats.currentBatch || 0,
        progress: mapped === "running" ? pct : mapped === "success" ? 100 : get().progress,
        message: data.status || "",
        errorMessage: mapped === "failed" ? data.error || "Scan failed" : "",
        failedScanId: mapped === "failed" ? scanId : null,
      });

      if (["success", "failed", "cancelled"].includes(mapped)) {
        stopPolling();
        useDashboardStore.getState().bumpRefresh();
        if (mapped === "success") toast.success("Keyword scan completed");
        else if (mapped === "failed") toast.error(data.error || "Scan failed");
        else if (mapped === "cancelled") toast.info("Scan cancelled");
      }
    } catch (err) {
      stopPolling();
      set({
        status: "failed",
        errorMessage: (err as Error).message || "Scan failed",
        failedScanId: scanId,
      });
    }
  };

  stopPollRef = startVisibleInterval(poll, KEYWORD_POLL_MS);
}

function resolveErrorPollStatus(
  serverStatus: string | undefined,
  current: ScanStore
): ScanStatus {
  const mapped = mapErrorStatus(serverStatus);
  if (
    mapped === "idle" &&
    current.moduleId === "error-check" &&
    (current.status === "running" || current.message === "Checking pages…" || current.message === "Starting check…")
  ) {
    return "running";
  }
  return mapped;
}

function startErrorPolling(get: () => ScanStore, set: (p: Partial<ScanStore>) => void) {
  stopPolling();

  const poll = async () => {
    try {
      const data = await api.getErrorCheckStatus();
      const current = get();
      const mapped = resolveErrorPollStatus(data.status, current);
      const processed = data.stats?.urlsProcessed || data.checked || 0;
      const total = data.total || data.stats?.urlsDiscovered || 0;
      const pct = total ? Math.min(100, Math.round((processed / total) * 100)) : processed > 0 ? 5 : 0;

      set({
        moduleId: "error-check",
        status: mapped,
        urlsProcessed: processed,
        errorCount: data.stats?.errorCount || 0,
        currentUrl: data.currentUrl || "",
        progress: mapped === "running" ? pct : mapped === "success" ? 100 : current.progress,
        message: mapped === "running" ? "Checking pages…" : mapped === "idle" ? current.message : data.status || "",
        errorMessage: mapped === "failed" ? data.error || "Check failed" : "",
      });

      if (["success", "failed", "cancelled"].includes(mapped)) {
        stopPolling();
        useDashboardStore.getState().bumpRefresh();
        if (mapped === "success") toast.success("Link check completed");
        else if (mapped === "failed") toast.error(data.error || "Check failed");
        else if (mapped === "cancelled") toast.info("Check cancelled");
      }
    } catch {
      /* ignore transient poll errors while running */
    }
  };

  stopPollRef = startVisibleInterval(poll, ERROR_POLL_MS);
}