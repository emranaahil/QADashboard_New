const API_BASE =
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "")
    : process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export type Job = {
  id: string;
  moduleId: string;
  status: string;
  progress: number;
  message?: string;
  url: string;
  error?: string;
  reportAvailable?: boolean;
  totalPages?: number;
  currentPage?: number;
  currentUrl?: string;
  createdAt: string;
  completedAt?: string;
  lastHeartbeatAt?: string;
  durationMs?: number;
  testType?: "single-page" | "full-website";
  options?: {
    devices?: Array<string | { name: string; width: number; height: number }>;
    browser?: string;
    _resolvedDevices?: Array<{ label: string; width: number; height: number }>;
    maxPages?: number;
    mode?: string;
  };
  executionState?: {
    currentPage: number;
    totalPages: number;
    currentUrl: string;
    progressPercent: number;
  };
};

export type UiTestingHistoryItem = {
  id: string;
  url: string;
  title?: string;
  testType: "single-page" | "full-website";
  moduleId: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  durationMs?: number;
  reportAvailable?: boolean;
  hasQaIssues?: boolean;
  message?: string;
  error?: string;
  progress?: number;
  totalPages?: number;
  currentPage?: number;
};

export type UiTestingHistoryResponse = {
  testType: "single-page" | "full-website";
  moduleId: string;
  heading: string;
  total: number;
  grouped: Array<{
    date: string;
    dateLabel: string;
    reports: UiTestingHistoryItem[];
  }>;
  items: UiTestingHistoryItem[];
};

export type SeoTestingHistoryItem = {
  id: string;
  url: string;
  title?: string;
  testType: "single-page" | "full-website";
  moduleId: "seo";
  status: string;
  createdAt: string;
  completedAt?: string;
  durationMs?: number;
  reportAvailable?: boolean;
  hasQaIssues?: boolean;
  message?: string;
  error?: string;
  progress?: number;
  totalPages?: number;
  currentPage?: number;
};

export type SeoTestingHistoryResponse = {
  testType: "single-page" | "full-website";
  moduleId: "seo";
  heading: string;
  total: number;
  grouped: Array<{
    date: string;
    dateLabel: string;
    reports: SeoTestingHistoryItem[];
  }>;
  items: SeoTestingHistoryItem[];
};

export type DashboardStats = {
  totalTests: number;
  passed: number;
  failed: number;
  running: number;
  successRate: number;
  trends: { passed: string; failed: string; successRate: string };
  recentRuns: Array<{
    id: string;
    moduleId: string;
    url: string;
    status: string;
    progress: number;
    createdAt: string;
    reportAvailable?: boolean;
  }>;
};

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = "REQUEST_FAILED", status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function apiUrl(path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${p}` : p;
}

import { getSessionHeaders, withSessionQuery } from "./session";

async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(url), {
      ...options,
      headers: {
        Accept: "application/json",
        ...getSessionHeaders(),
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new ApiError(
      "Cannot reach QA API. Start the backend: npm run dev (port 3000)",
      "NETWORK_ERROR",
      0
    );
  }

  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");

  if (!isJson) {
    const snippet = (await res.text()).slice(0, 120);
    if (res.status === 404) {
      throw new ApiError("API endpoint not found. Is the backend running on port 3000?", "NOT_FOUND", 404);
    }
    throw new ApiError(
      res.ok
        ? "Server returned non-JSON response"
        : `API error (${res.status})${snippet ? `: ${snippet}` : ""}`,
      "INVALID_RESPONSE",
      res.status
    );
  }

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      (data.message as string) || (data.error as string) || `Request failed (${res.status})`,
      (data.error as string) || "REQUEST_FAILED",
      res.status
    );
  }
  return data as T;
}

export const api = {
  health: () => fetchJson<{ status: string }>("/api/health"),

  getDashboardStats: () => fetchJson<DashboardStats>("/api/dashboard/stats"),

  getDevices: () =>
    fetchJson<{ devices: Array<{ id: string; label: string; width: number; height: number }> }>(
      "/api/config/devices"
    ),

  getBrowsers: () =>
    fetchJson<{ browsers: Array<{ id: string; label: string; warning?: boolean }> }>(
      "/api/config/browsers"
    ),

  getHistory: (opts?: { limit?: number; moduleId?: string; q?: string }) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.moduleId) params.set("moduleId", opts.moduleId);
    if (opts?.q) params.set("q", opts.q);
    const qs = params.toString();
    return fetchJson<{ items: Job[]; grouped: Array<{ date: string; runs: Job[] }> }>(
      `/api/history${qs ? `?${qs}` : ""}`
    );
  },

  getUiTestingHistory: (opts: { type: "single-page" | "full-website"; q?: string; limit?: number }) => {
    const params = new URLSearchParams({ type: opts.type });
    if (opts.q) params.set("q", opts.q);
    if (opts.limit) params.set("limit", String(opts.limit));
    return fetchJson<UiTestingHistoryResponse>(`/api/ui-testing/history?${params}`);
  },

  deleteUiTestingHistory: (jobId: string, type: "single-page" | "full-website") => {
    const params = new URLSearchParams({ type });
    return fetchJson<{ ok: boolean }>(
      `/api/ui-testing/history/${encodeURIComponent(jobId)}?${params}`,
      { method: "DELETE" }
    );
  },

  getSeoTestingHistory: (opts: { type: "single-page" | "full-website"; q?: string; limit?: number }) => {
    const params = new URLSearchParams({ type: opts.type });
    if (opts.q) params.set("q", opts.q);
    if (opts.limit) params.set("limit", String(opts.limit));
    return fetchJson<SeoTestingHistoryResponse>(`/api/seo-testing/history?${params}`);
  },

  deleteSeoTestingHistory: (jobId: string, type: "single-page" | "full-website") => {
    const params = new URLSearchParams({ type });
    return fetchJson<{ ok: boolean }>(
      `/api/seo-testing/history/${encodeURIComponent(jobId)}?${params}`,
      { method: "DELETE" }
    );
  },

  getReportsCenter: (opts?: { limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return fetchJson<{
      reports: Array<{
        id: string;
        title?: string;
        moduleId: string;
        moduleName: string;
        generatedAt?: string;
        hasHtml?: boolean;
      }>;
    }>(`/api/reports-center${qs ? `?${qs}` : ""}`);
  },

  getReport: (moduleId: string, reportId: string) =>
    fetchJson<{ meta?: Record<string, unknown>; data?: unknown }>(
      `/api/modules/${moduleId}/reports/${encodeURIComponent(reportId)}`
    ),

  startJob: (moduleId: string, body: { url: string; options?: Record<string, unknown> }) =>
    fetchJson<{ job: Job }>(`/api/modules/${moduleId}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  getJob: (moduleId: string, jobId: string) =>
    fetchJson<{ job: Job }>(`/api/modules/${moduleId}/jobs/${jobId}`),

  getActiveJob: () =>
    fetchJson<{ active: boolean; job: Job | null }>("/api/execution/active"),

  cancelExecution: (moduleId: string, jobId: string) =>
    fetchJson<{ job: Job }>("/api/execution/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleId, jobId }),
    }),

  jobReportUrl: (moduleId: string, jobId: string) =>
    apiUrl(`/api/modules/${moduleId}/jobs/${encodeURIComponent(jobId)}/report`),

  moduleReportPdfUrl: (moduleId: string, reportId: string) =>
    apiUrl(`/api/modules/${moduleId}/reports/${encodeURIComponent(reportId)}/pdf`),

  scanReportUrl: (scanId: string) =>
    apiUrl(`/api/scan/${encodeURIComponent(scanId)}/report`),

  jobLogUrl: (moduleId: string, jobId: string) =>
    apiUrl(`/api/modules/${moduleId}/jobs/${encodeURIComponent(jobId)}/logs`),

  scanLogUrl: (scanId: string) => apiUrl(`/api/scan/${encodeURIComponent(scanId)}/logs`),

  errorCheckLogUrl: () => apiUrl("/api/check-broken-pages/logs"),

  getActiveKeywordScan: () =>
    fetchJson<{
      active: boolean;
      scanId?: string;
      status?: string;
      url?: string;
      stats?: Record<string, number>;
    }>("/api/scan/active"),

  startKeywordScan: (url: string, keywords: string[]) =>
    fetchJson<{ scanId: string }>("/api/scan/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, keywords }),
    }),

  getKeywordScanStatus: (scanId: string) =>
    fetchJson<{
      scanId: string;
      status: string;
      stats?: {
        urlsDiscovered?: number;
        urlsProcessed?: number;
        matchesFound?: number;
        currentBatch?: number;
      };
      error?: string;
    }>(`/api/scan/${encodeURIComponent(scanId)}/status`),

  cancelKeywordScan: (scanId: string) =>
    fetchJson<{ scanId: string; status: string }>(`/api/scan/${encodeURIComponent(scanId)}/cancel`, {
      method: "POST",
    }),

  startErrorCheck: (url: string, options?: { maxUrls?: number; maxDepth?: number }) =>
    fetchJson<{ status: string; runId: string }>("/api/check-broken-pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        maxUrls: options?.maxUrls ?? 100,
        maxDepth: options?.maxDepth ?? 5,
        delay: 400,
      }),
    }),

  getErrorCheckStatus: () =>
    fetchJson<{
      status?: string;
      runId?: string | null;
      error?: string | null;
      currentUrl?: string;
      checked?: number;
      total?: number;
      stats?: { urlsProcessed?: number; errorCount?: number; urlsDiscovered?: number };
    }>("/api/check-broken-pages/status"),

  cancelErrorCheck: () =>
    fetchJson<{ status: string }>("/api/check-broken-pages/cancel", { method: "POST" }),

  subscribeJobEvents: (
    moduleId: string,
    jobId: string,
    onUpdate: (job: Job) => void,
    onError?: (err: Error) => void
  ) => {
    let es: EventSource | null = null;
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;

    const connect = () => {
      if (closed) return;
      es = new EventSource(
        withSessionQuery(apiUrl(`/api/modules/${moduleId}/jobs/${jobId}/events`))
      );
      es.onmessage = (e) => {
        reconnectAttempt = 0;
        try {
          const data = JSON.parse(e.data);
          if (data.job) onUpdate(data.job);
          if (data.error) onError?.(new Error(data.error));
        } catch (err) {
          onError?.(err as Error);
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (closed) return;
        const delay = Math.min(30_000, 1000 * 2 ** reconnectAttempt);
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  },
};