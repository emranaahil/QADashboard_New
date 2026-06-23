/**
 * Shared API client — each module uses only its own endpoints.
 */
const ModuleAPI = {
  async fetchJson(url, options = {}) {
    const res = await fetch(url, options);
    let data;
    try {
      data = await res.json();
    } catch {
      data = { error: 'PARSE_ERROR', message: 'Invalid response from server' };
    }
    if (!res.ok) {
      const err = new Error(data.message || data.error || `Request failed (${res.status})`);
      err.code = data.error || 'REQUEST_FAILED';
      err.status = res.status;
      throw err;
    }
    return data;
  },

  async listModules() {
    return this.fetchJson('/api/modules');
  },

  async getModule(moduleId) {
    return this.fetchJson(`/api/modules/${moduleId}`);
  },

  async listReports(moduleId) {
    return this.fetchJson(`/api/modules/${moduleId}/reports`);
  },

  async getLatestReport(moduleId) {
    return this.fetchJson(`/api/modules/${moduleId}/reports/latest`);
  },

  async getReport(moduleId, reportId) {
    return this.fetchJson(`/api/modules/${moduleId}/reports/${encodeURIComponent(reportId)}`);
  },

  htmlReportUrl(moduleId, reportId) {
    if (reportId) {
      return `/api/modules/${moduleId}/reports/${encodeURIComponent(reportId)}/html`;
    }
    return `/api/modules/${moduleId}/reports/latest/html`;
  },

  pdfReportUrl(moduleId, reportId) {
    return `/api/modules/${moduleId}/reports/${encodeURIComponent(reportId)}/pdf`;
  },

  async getDevices() {
    return this.fetchJson('/api/config/devices');
  },

  async getBrowsers() {
    return this.fetchJson('/api/config/browsers');
  },

  async getDashboardStats() {
    return this.fetchJson('/api/dashboard/stats');
  },

  async getHistory(opts = {}) {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', opts.limit);
    if (opts.moduleId) params.set('moduleId', opts.moduleId);
    const qs = params.toString();
    return this.fetchJson(`/api/history${qs ? `?${qs}` : ''}`);
  },

  async deleteHistoryEntry(moduleId, jobId) {
    return this.fetchJson(`/api/history/${moduleId}/${jobId}`, { method: 'DELETE' });
  },

  async getUiTestingHistory({ type, q, limit } = {}) {
    const params = new URLSearchParams();
    params.set('type', type);
    if (q) params.set('q', q);
    if (limit) params.set('limit', limit);
    return this.fetchJson(`/api/ui-testing/history?${params}`);
  },

  async deleteUiTestingHistory(jobId, type) {
    const params = new URLSearchParams({ type });
    return this.fetchJson(
      `/api/ui-testing/history/${encodeURIComponent(jobId)}?${params}`,
      { method: 'DELETE' }
    );
  },

  async getReportsCenter(opts = {}) {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', opts.limit);
    if (opts.moduleId) params.set('moduleId', opts.moduleId);
    const qs = params.toString();
    return this.fetchJson(`/api/reports-center${qs ? `?${qs}` : ''}`);
  },

  // Test execution status API (backend-driven lifecycle)
  async getTestStatus(modelId, testType) {
    return this.fetchJson(`/api/test-status/${encodeURIComponent(modelId)}/${testType}`);
  },

  async getActiveTestStatus(testType) {
    return this.fetchJson(`/api/test-status/active/${testType}`);
  },

  // Job execution API (SEO, UI Check, Full UI Check)
  async startJob(moduleId, { url, options, user }) {
    return this.fetchJson(`/api/modules/${moduleId}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, options, user })
    });
  },

  async listJobs(moduleId) {
    return this.fetchJson(`/api/modules/${moduleId}/jobs`);
  },

  async getJob(moduleId, jobId) {
    return this.fetchJson(`/api/modules/${moduleId}/jobs/${jobId}`);
  },

  async cancelJob(moduleId, jobId) {
    return this.fetchJson(`/api/modules/${moduleId}/jobs/${jobId}/cancel`, { method: 'POST' });
  },

  async cancelExecution(moduleId, jobId) {
    return this.fetchJson('/api/execution/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moduleId, jobId })
    });
  },

  async getExecutionStatus(moduleId, jobId) {
    return this.fetchJson(`/api/execution/status/${moduleId}/${jobId}`);
  },

  async getExecutionProgress(moduleId, jobId) {
    return this.fetchJson(`/api/execution/progress/${moduleId}/${jobId}`);
  },

  jobReportUrl(moduleId, jobId) {
    return `/api/modules/${moduleId}/jobs/${encodeURIComponent(jobId)}/report`;
  },

  /** PERFORMANCE: Fixed EventSource with proper cleanup, no reconnection loops, single handler */
  subscribeJobEvents(moduleId, jobId, onUpdate, onError) {
    const url = `/api/modules/${moduleId}/jobs/${jobId}/events`;
    let es;
    let isCleanedUp = false;

    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      if (es) {
        es.onmessage = null;
        es.onerror = null;
        es.close();
        es = null;
      }
    };

    try {
      es = new EventSource(url);
      es.onmessage = (e) => {
        if (isCleanedUp) return;
        try {
          const data = JSON.parse(e.data);
          if (data.job) onUpdate(data.job);
          if (data.error) onError?.(new Error(data.error));
        } catch (err) {
          onError?.(err);
        }
      };
      es.onerror = () => {
        cleanup();
        if (!isCleanedUp) {
          onError?.(new Error('Connection lost — falling back to polling'));
        }
      };
    } catch {
      if (!isCleanedUp) onError?.(new Error('SSE not supported'));
    }

    return cleanup;
  }
};

window.ModuleAPI = ModuleAPI;