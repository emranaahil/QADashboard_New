/**
 * Shared job runner UI — backend-driven execution lifecycle (SSE single source of truth).
 * PERFORMANCE: throttled updates, batched logs, memoized renders, cleanup on unmount
 */
class JobRunner {
  constructor({ moduleId, defaultRunLabel = 'Run Test' }) {
    this.moduleId = moduleId;
    this.testType = moduleId;
    this.activeJobId = null;
    this.unsubscribe = null;
    this.pollTimer = null;
    this.currentStatus = 'idle';
    this.logsFrozen = false;
    this.lastExecutionState = null;

    this.statusEl = document.getElementById('job-status');
    this.progressEl = document.getElementById('job-progress-fill');
    this.progressTextEl = document.getElementById('job-progress-text');
    this.messageEl = document.getElementById('job-message');
    this.historyEl = document.getElementById('job-history');
    this.runBtn = document.getElementById('runJobBtn');
    this.cancelBtn = document.getElementById('cancelJobBtn');
    this.openReportBtn = document.getElementById('openReportBtn');
    this.urlInput = document.getElementById('testUrl');

    this.defaultRunLabel = defaultRunLabel;
    if (this.runBtn && !this.runBtn.textContent.trim()) {
      this.runBtn.textContent = defaultRunLabel;
    }
    if (this.cancelBtn) {
      this.cancelBtn.textContent = 'Cancel Test';
    }
    this.storageKey = `qa:lastUrl:${moduleId}`;

    // --- PERFORMANCE: throttling state ---
    this._lastUpdateTs = 0;
    this._updateThrottleMs = 500; // max 1 update per 500ms
    this._pendingBatchUpdate = null;
    this._logBuffer = [];
    this._logFlushTimer = null;
    this._logFlushInterval = 1500; // batch logs every 1.5s
    this._maxLogLines = 500; // max DOM log nodes
    this._mounted = true; // track component lifecycle
  }

  deriveModelId(url) {
    if (!url) return null;
    try {
      let clean = url.trim();
      if (!/^https?:\/\//i.test(clean)) clean = `https://${clean}`;
      return new URL(clean).hostname.toLowerCase().replace(/[^a-z0-9.-]/g, '-');
    } catch {
      return null;
    }
  }

  canShowOpenReport(status) {
    return !!(
      status &&
      status.status === 'completed' &&
      status.reportAvailable === true &&
      status.jobId
    );
  }

  jobToStatus(job) {
    if (!job) return null;
    const es = job.executionState || {};
    return {
      status: job.status === 'pending' ? 'running' : job.status,
      reportAvailable: job.reportAvailable,
      reportPath: job.reportPath,
      jobId: job.id,
      progress: es.progressPercent ?? job.progress ?? 0,
      message: job.message,
      error: job.error,
      url: job.url,
      currentPage: es.currentPage ?? job.currentPage ?? 0,
      totalPages: es.totalPages ?? job.totalPages ?? 0,
      currentUrl: es.currentUrl ?? job.currentUrl ?? '',
      durationMs: job.durationMs,
      logs: job.logs || []
    };
  }

  async init() {
    this.runBtn?.addEventListener('click', () => this.start());
    this.cancelBtn?.addEventListener('click', () => this.cancel());
    this.openReportBtn?.addEventListener('click', () => this.openReport());
    this.urlInput?.addEventListener('change', () => this.onUrlChange());

    this.renderIdle();
    await this.loadHistory();
    await this.restoreFromBackend();
  }

  /** PERFORMANCE: call this on page unmount to prevent memory leaks */
  destroy() {
    this._mounted = false;
    this.stopWatching();
    if (this._logFlushTimer) {
      clearTimeout(this._logFlushTimer);
      this._logFlushTimer = null;
    }
    this._logBuffer = [];
    this._pendingBatchUpdate = null;
  }

  onUrlChange() {
    const url = this.getUrl();
    if (url) localStorage.setItem(this.storageKey, url);
  }

  getUrl() {
    return this.urlInput?.value?.trim() || '';
  }

  getJobOptions() {
    const opts = {};
    const mode = document.getElementById('testMode')?.value;
    if (mode) opts.mode = mode;
    return opts;
  }

  renderIdle() {
    this.currentStatus = 'idle';
    this.activeJobId = null;
    this.logsFrozen = false;
    this.lastExecutionState = null;
    if (this.statusEl) this.statusEl.innerHTML = '';
    if (this.progressEl) this.progressEl.style.width = '0%';
    if (this.progressTextEl) this.progressTextEl.textContent = '0%';
    if (this.messageEl) this.messageEl.textContent = '';
    const pagesEl = document.getElementById('job-pages');
    if (pagesEl) pagesEl.textContent = '—';
    const urlEl = document.getElementById('job-current-url');
    if (urlEl) urlEl.textContent = '';
    this.setRunningUi(false);
    this.setOpenReportVisible(false);
    this.showError(null);
  }

  async restoreFromBackend() {
    if (!this._mounted) return;
    try {
      const active = await ModuleAPI.getActiveTestStatus(this.testType);
      if (active.status === 'running' && active.jobId) {
        if (active.url && this.urlInput) this.urlInput.value = active.url;
        localStorage.setItem(this.storageKey, active.url || '');
        this.applyStatus({
          ...active,
          status: 'running',
          currentPage: active.currentPage,
          totalPages: active.totalPages,
          currentUrl: active.currentUrl
        });
        this.watchJob(active.jobId);
        return;
      }

      const savedUrl = localStorage.getItem(this.storageKey) || this.getUrl();
      if (savedUrl && this.urlInput && !this.getUrl()) {
        this.urlInput.value = savedUrl;
      }

      const modelId = this.deriveModelId(savedUrl || this.getUrl());
      if (!modelId) {
        this.renderIdle();
        return;
      }

      const status = await ModuleAPI.getTestStatus(modelId, this.testType);
      if (status.status === 'cancelled') {
        this.renderIdle();
        return;
      }
      this.applyStatus(status);

      if (status.status === 'running' && status.jobId) {
        this.watchJob(status.jobId);
      }
    } catch {
      if (this._mounted) this.renderIdle();
    }
  }

  updatePagesDisplay(status) {
    const pagesEl = document.getElementById('job-pages');
    const urlEl = document.getElementById('job-current-url');
    if (!pagesEl && !urlEl) return;

    const total = status?.totalPages;
    const current = status?.currentPage;

    if (pagesEl && total != null && total > 0) {
      pagesEl.textContent = `${current ?? 0} / ${total} Pages`;
    } else if (pagesEl && status?.status === 'running') {
      pagesEl.textContent = `${status.progress || 0}%`;
    } else if (pagesEl) {
      pagesEl.textContent = '—';
    }

    if (urlEl) {
      if (status?.currentUrl) {
        try {
          const path = status.currentUrl.startsWith('http')
            ? new URL(status.currentUrl).pathname
            : status.currentUrl;
          urlEl.textContent = `Current Page: ${path}`;
        } catch {
          urlEl.textContent = `Current Page: ${status.currentUrl}`;
        }
      } else if (status?.url && status?.status === 'running') {
        urlEl.textContent = `Target: ${status.url}`;
      } else {
        urlEl.textContent = '';
      }
    }
  }

  /** PERFORMANCE: throttled applyStatus — skips updates if <500ms since last */
  applyStatus(status, force = false) {
    if (!status) {
      this.renderIdle();
      return;
    }

    // Throttle: skip UI updates if too frequent (unless forced or terminal)
    const now = Date.now();
    const isTerminal = ['completed', 'failed', 'cancelled'].includes(status.status);
    if (!force && !isTerminal && status.status === 'running') {
      if (now - this._lastUpdateTs < this._updateThrottleMs) {
        // Queue the latest update for later
        this._pendingBatchUpdate = status;
        return;
      }
    }
    this._lastUpdateTs = now;
    this._pendingBatchUpdate = null;

    this.currentStatus = status.status;
    this.activeJobId = status.jobId || null;
    this.lastExecutionState = status;

    const statusMap = {
      idle: { label: '', cls: '' },
      running: { label: 'Running...', cls: 'status-running' },
      completed: { label: 'Completed', cls: 'status-completed' },
      failed: { label: 'Failed', cls: 'status-failed' },
      cancelled: { label: 'Cancelled', cls: 'status-failed' }
    };
    const s = statusMap[status.status] || { label: status.status, cls: '' };

    if (this.statusEl) {
      this.statusEl.innerHTML = s.label
        ? `<span class="job-status-badge ${s.cls}">${s.label}</span>`
        : '';
    }
    if (this.progressEl) this.progressEl.style.width = `${status.progress || 0}%`;
    if (this.progressTextEl) this.progressTextEl.textContent = `${status.progress || 0}%`;
    if (this.messageEl) this.messageEl.textContent = status.message || '';

    const isRunning = status.status === 'running';
    this.setRunningUi(isRunning);
    this.setOpenReportVisible(this.canShowOpenReport(status));

    if (status.status === 'failed' && status.error) {
      this.showError(status.error);
    } else if (status.status === 'cancelled') {
      this.showError(null);
      this.logsFrozen = true;
      this.setRunningUi(false);
      if (typeof Toast !== 'undefined') Toast.info('Test cancelled');
    } else if (status.status === 'completed') {
      this.showError(null);
    } else if (status.status === 'idle') {
      this.showError(null);
    }

    this.updatePagesDisplay(status);

    if (typeof EnterpriseShell !== 'undefined') {
      const execState = status.status === 'running' ? 'running'
        : status.status === 'completed' ? 'success'
          : status.status === 'failed' ? 'failed'
            : status.status === 'cancelled' ? 'idle' : 'idle';
      EnterpriseShell.setExecutionStatus(execState);
    }

    this.onStatusChange?.(status);
  }

  /** PERFORMANCE: flush any queued throttled update */
  _flushPendingUpdate() {
    if (this._pendingBatchUpdate && this._mounted) {
      this.applyStatus(this._pendingBatchUpdate, true);
    }
  }

  async start() {
    const url = this.getUrl();
    if (!url) {
      this.showError('Please enter a URL');
      return;
    }

    this.logsFrozen = false;
    localStorage.setItem(this.storageKey, url);
    this.setRunningUi(true);
    this.setOpenReportVisible(false);
    this.showError(null);

    const liveLogs = document.getElementById('liveLogs');
    if (liveLogs) liveLogs.innerHTML = '<div class="ep-log-line">Starting execution...</div>';

    if (this.statusEl) {
      this.statusEl.innerHTML = '<span class="job-status-badge status-running">Running...</span>';
    }

    const pagesEl = document.getElementById('job-pages');
    if (pagesEl) pagesEl.textContent = '0 / — Pages';

    try {
      const { job } = await ModuleAPI.startJob(this.moduleId, {
        url,
        options: this.getJobOptions()
      });
      this.activeJobId = job.id;
      this.watchJob(job.id);
      await this.loadHistory();
    } catch (err) {
      if (err.status === 409 && err.code === 'ALREADY_RUNNING') {
        this.showError('A test is already running for this URL.');
        await this.restoreFromBackend();
        return;
      }
      this.showError(err.message || 'Failed to start test');
      this.setRunningUi(false);
      await this.restoreFromBackend();
    }
  }

  async cancel() {
    if (!this.activeJobId) return;
    try {
      await ModuleAPI.cancelExecution(this.moduleId, this.activeJobId);
      this.logsFrozen = true;
      this.stopWatching();
      const { job } = await ModuleAPI.getJob(this.moduleId, this.activeJobId);
      this.applyStatus(this.jobToStatus(job));
      await this.loadHistory();
    } catch (err) {
      try {
        await ModuleAPI.cancelJob(this.moduleId, this.activeJobId);
        this.logsFrozen = true;
        this.stopWatching();
        await this.restoreFromBackend();
        await this.loadHistory();
      } catch (fallbackErr) {
        this.showError(fallbackErr.message || err.message);
      }
    }
  }

  async openReport(jobId) {
    const id = jobId || this.activeJobId;
    if (!id) return;

    try {
      const modelId = this.deriveModelId(this.getUrl());
      let status;
      if (modelId) {
        status = await ModuleAPI.getTestStatus(modelId, this.testType);
      } else {
        const { job } = await ModuleAPI.getJob(this.moduleId, id);
        status = this.jobToStatus(job);
      }

      if (!this.canShowOpenReport(status) || status.jobId !== id) {
        this.showError('Report not available');
        return;
      }

      const reportRes = await fetch(ModuleAPI.jobReportUrl(this.moduleId, id), { method: 'HEAD' });
      if (!reportRes.ok) {
        this.showError('Report not available');
        this.setOpenReportVisible(false);
        return;
      }

      window.open(ModuleAPI.jobReportUrl(this.moduleId, id), '_blank');
    } catch {
      this.showError('Report not available');
    }
  }

  /** PERFORMANCE: watchJob with proper cleanup — no duplicate listeners */
  watchJob(jobId) {
    this.stopWatching();
    this.activeJobId = jobId;

    const onUpdate = (job) => {
      if (!this._mounted) return;
      if (this.logsFrozen && job.status !== 'running' && job.status !== 'pending') return;
      const status = this.jobToStatus(job);
      this.applyStatus(status);

      // Flush pending after a brief interval to catch up
      if (this._pendingBatchUpdate) {
        setTimeout(() => this._flushPendingUpdate(), this._updateThrottleMs + 50);
      }

      if (['completed', 'failed', 'cancelled'].includes(status.status)) {
        this._flushPendingUpdate();
        this.stopWatching();
        this.loadHistory();
        if (status.status === 'completed') {
          document.dispatchEvent(new CustomEvent('qa:job-completed', {
            detail: { moduleId: this.moduleId, jobId: status.jobId }
          }));
        }
      }
    };

    this.unsubscribe = ModuleAPI.subscribeJobEvents(this.moduleId, jobId, onUpdate, () => {
      this.startStatusPolling(jobId);
    });

    this.startStatusPolling(jobId);
  }

  startStatusPolling(jobId) {
    if (this.pollTimer) clearInterval(this.pollTimer);

    const poll = async () => {
      if (!this._mounted) return;
      if (this.logsFrozen && this.currentStatus === 'cancelled') return;
      try {
        const { job } = await ModuleAPI.getJob(this.moduleId, jobId);
        const status = this.jobToStatus(job);
        this.applyStatus(status);

        if (this._pendingBatchUpdate) {
          setTimeout(() => this._flushPendingUpdate(), this._updateThrottleMs + 50);
        }

        if (['completed', 'failed', 'cancelled'].includes(status.status)) {
          this._flushPendingUpdate();
          this.stopWatching();
          await this.loadHistory();
          if (status.status === 'completed') {
            document.dispatchEvent(new CustomEvent('qa:job-completed', {
              detail: { moduleId: this.moduleId, jobId: status.jobId }
            }));
          }
        }
      } catch { /* ignore */ }
    };

    this.pollTimer = setInterval(poll, 2000);
    poll();
  }

  stopWatching() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.currentStatus !== 'running') {
      this.setRunningUi(false);
    }
  }

  setOpenReportVisible(visible) {
    if (!this.openReportBtn) return;
    this.openReportBtn.classList.toggle('hidden', !visible);
  }

  setRunningUi(running) {
    if (this.runBtn) {
      this.runBtn.disabled = running;
      this.runBtn.textContent = running ? 'Running...' : this.defaultRunLabel;
    }
    if (this.cancelBtn) {
      this.cancelBtn.classList.toggle('hidden', !running);
      this.cancelBtn.disabled = !running;
    }
    if (running) this.setOpenReportVisible(false);
  }

  showError(msg) {
    const el = document.getElementById('job-error');
    if (!el) return;
    if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  formatDuration(ms) {
    if (!ms) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  async loadHistory() {
    if (!this.historyEl || !this._mounted) return;
    try {
      const { jobs } = await ModuleAPI.listJobs(this.moduleId);
      if (!jobs.length) {
        this.historyEl.innerHTML = '<p class="form-hint">No test history yet.</p>';
        return;
      }

      this.historyEl.innerHTML = jobs.map(job => {
        const date = job.completedAt || job.createdAt;
        const canOpen = job.status === 'completed' && job.reportAvailable;
        return `<div class="history-item" data-job-id="${job.id}">
          <div class="history-row">
            <strong>${job.url}</strong>
            <span class="job-status-badge status-${job.status}">${job.status}</span>
          </div>
          <div class="history-meta">
            <span>Last run: ${date ? new Date(date).toLocaleString() : '—'}</span>
            <span>Duration: ${this.formatDuration(job.durationMs)}</span>
          </div>
          <div class="history-actions">
            ${canOpen
              ? `<button class="ep-btn btn-sm" onclick="window.__jobRunner.openReport('${job.id}')">Open Report</button>`
              : (job.status === 'failed' ? '<span class="form-hint">Report not available</span>' : '')}
          </div>
        </div>`;
      }).join('');
    } catch (err) {
      if (this._mounted) this.historyEl.innerHTML = `<p class="ep-warning">${err.message}</p>`;
    }
  }
}

window.JobRunner = JobRunner;