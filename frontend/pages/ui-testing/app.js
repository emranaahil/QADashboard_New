/**
 * Unified UI Testing — Single Page + Full Website via segmented control.
 * Preserves existing job APIs: ui-check (single), full-ui-check (full).
 */
class UITestingApp {
  constructor() {
    this.mode = new URLSearchParams(location.search).get('mode') === 'full' ? 'full' : 'single';
    this.devices = [];
    this.browsers = [];
    this.customDevices = [];
    this.selectedDevices = new Set(['desktop']);
    this.selectedBrowser = 'chrome';
    this.runner = null;
    this.logsFrozen = false;
  }

  get moduleId() {
    return this.mode === 'full' ? 'full-ui-check' : 'ui-check';
  }

  get testType() {
    return this.mode === 'full' ? 'full-website' : 'single-page';
  }

  get deviceCount() {
    const preset = this.selectedDevices.size;
    const custom = this.customDevices.length;
    return preset + custom;
  }

  async init() {
    await EnterpriseShell.mount({
      title: 'UI Testing',
      subtitle: 'Single page and full website visual QA',
      activePath: '/ui-testing'
    });

    this.bindMode();
    await this.loadConfig();
    this.bindDevices();
    this.bindBrowsers();
    this.applyMode();

    await this.initHistory();
    this.bindHistoryEvents();

    this.runner = new JobRunner({ moduleId: this.moduleId, defaultRunLabel: 'Run Test' });
    this.patchRunner();
    await this.runner.init();
    window.__jobRunner = this.runner;
    this.syncWorkflowFromRunner();
  }

  syncWorkflowFromRunner() {
    const status = this.runner?.lastExecutionState || {
      status: this.runner?.currentStatus || 'idle'
    };
    this.updateWorkflowState(status);
    if (['completed', 'failed'].includes(status.status)) {
      this.updateResults(status);
    }
  }

  async initHistory() {
    if (typeof UiTestingHistory === 'undefined') return;
    window.__uiTestingHistory = UiTestingHistory;
    await UiTestingHistory.init({
      testType: this.testType,
      onSelectReport: (item) => this.showHistoryJob(item)
    });
    this.history = UiTestingHistory;
  }

  bindHistoryEvents() {
    document.addEventListener('qa:job-completed', (e) => {
      if (!this.history) return;
      const mod = e.detail?.moduleId;
      if (mod === 'ui-check' || mod === 'full-ui-check') {
        this.history.refresh();
      }
    });
  }

  patchRunner() {
    this.runner.getJobOptions = () => this.buildOptions();

    const defaultLoadHistory = this.runner.loadHistory.bind(this.runner);
    this.runner.loadHistory = async () => {
      if (this.history) {
        await this.history.refresh();
      } else {
        await defaultLoadHistory();
      }
    };

    this.runner.onStatusChange = (status) => {
      if (status?.status === 'cancelled') {
        this.logsFrozen = true;
        this.runner.logsFrozen = true;
      }
      if (status?.status === 'running') {
        this.logsFrozen = false;
        this.runner.logsFrozen = false;
      }

      this.updateWorkflowState(status);
      this.updateResults(status);
      this.updatePagesFromBackend(status);

      if (!this.logsFrozen && status?.message) {
        this.appendLog(status.message);
      }
      if (status?.jobId && ['completed', 'failed', 'cancelled'].includes(status.status)) {
        this.loadJobLogs(status.jobId);
      }
    };
  }

  updatePagesFromBackend(status) {
    const pagesEl = document.getElementById('job-pages');
    if (!pagesEl || !status) return;
    if (status.totalPages > 0) {
      pagesEl.textContent = `${status.currentPage ?? 0} / ${status.totalPages} Pages`;
    }
  }

  async loadJobLogs(jobId) {
    try {
      const { job } = await ModuleAPI.getJob(this.moduleId, jobId);
      if (job?.logs?.length && typeof LogsDrawer !== 'undefined') {
        LogsDrawer.setLogs(job.logs.map(l => ({ ...l, type: 'info' })));
      }
    } catch { /* ignore */ }
  }

  buildOptions() {
    const selected = [...this.selectedDevices];
    this.customDevices.forEach(d => selected.push(d));
    const opts = {
      devices: selected,
      browser: this.selectedBrowser
    };
    if (this.mode === 'full') {
      opts.maxPages = Number(document.getElementById('maxPages')?.value) || 50;
      opts.includeSubdomains = document.getElementById('includeSubdomains')?.checked || false;
      const ignore = document.getElementById('ignorePaths')?.value?.trim();
      if (ignore) opts.ignorePaths = ignore.split('\n').map(s => s.trim()).filter(Boolean);
      const rules = document.getElementById('customCrawlRules')?.value?.trim();
      if (rules) opts.customCrawlRules = rules;
    }
    return opts;
  }

  bindMode() {
    document.getElementById('modeSingle')?.addEventListener('click', () => {
      this.mode = 'single';
      this.applyMode();
      this.reinitRunner();
    });
    document.getElementById('modeFull')?.addEventListener('click', () => {
      this.mode = 'full';
      this.applyMode();
      this.reinitRunner();
    });

    document.getElementById('historyTypeFilter')?.addEventListener('change', (e) => {
      const type = e.target.value;
      const nextMode = type === 'full-website' ? 'full' : 'single';
      if (this.mode === nextMode) return;
      this.mode = nextMode;
      this.applyMode();
      this.reinitRunner();
    });
  }

  /** PERFORMANCE: destroy previous runner to prevent memory leaks */
  async reinitRunner() {
    this.runner?.destroy();
    this.runner = new JobRunner({ moduleId: this.moduleId, defaultRunLabel: 'Run Test' });
    this.patchRunner();
    await this.runner.init();
    window.__jobRunner = this.runner;
    this.syncWorkflowFromRunner();
    this.updateWarnings();
  }

  applyMode() {
    const single = document.getElementById('modeSingle');
    const full = document.getElementById('modeFull');
    single?.classList.toggle('active', this.mode === 'single');
    full?.classList.toggle('active', this.mode === 'full');
    single?.setAttribute('aria-selected', this.mode === 'single');
    full?.setAttribute('aria-selected', this.mode === 'full');

    document.getElementById('fullOnlyFields')?.classList.toggle('hidden', this.mode !== 'full');
    document.getElementById('urlLabel').textContent = this.mode === 'full' ? 'Website URL' : 'URL';

    const testTitle = document.getElementById('testCardTitle');
    if (testTitle) {
      testTitle.textContent = this.mode === 'full' ? 'Full Website UI Check' : 'Single Page UI Check';
    }

    if (this.runner) {
      this.runner.defaultRunLabel = 'Run Test';
      const runBtn = document.getElementById('runJobBtn');
      if (runBtn && this.runner.currentStatus !== 'running') {
        runBtn.textContent = 'Run Test';
      }
    }

    if (this.history && this.history.testType !== this.testType) {
      this.history.setTestType(this.testType);
    } else {
      this.history?.syncFilterDropdown();
      this.history?.syncHeading();
    }

    this.updateWarnings();
  }

  async showHistoryJob(item) {
    const moduleId = item.moduleId || this.moduleId;
    try {
      const { job } = await ModuleAPI.getJob(moduleId, item.id);
      if (!job) {
        Toast.warning('Report data is unavailable');
        return;
      }

      const urlInput = document.getElementById('testUrl');
      if (urlInput && job.url) urlInput.value = job.url;

      const status = this.runner.jobToStatus(job);
      await this.updateResults(status, moduleId);
    } catch (err) {
      Toast.error(err.message || 'Failed to load report');
    }
  }

  async loadConfig() {
    try {
      const [dev, br] = await Promise.all([
        ModuleAPI.getDevices(),
        ModuleAPI.getBrowsers()
      ]);
      this.devices = dev.devices || [];
      this.browsers = br.browsers || [];
    } catch {
      this.devices = [{ id: 'desktop', label: 'Desktop', width: 1440, height: 900 }];
      this.browsers = [{ id: 'chrome', label: 'Chrome', warning: false }];
    }
  }

  bindDevices() {
    this.renderDeviceGrid();
    document.getElementById('addCustomDevice')?.addEventListener('click', () => this.addCustomDevice());
  }

  renderDeviceGrid() {
    const grid = document.getElementById('deviceGrid');
    if (!grid) return;

    const presetHtml = this.devices.map(d => `
      <label class="ep-device-chip ${this.selectedDevices.has(d.id) ? 'selected' : ''}">
        <input type="checkbox" value="${d.id}" ${this.selectedDevices.has(d.id) ? 'checked' : ''}>
        ${d.label}
      </label>
    `).join('');

    const customHtml = this.customDevices.map((d, i) => `
      <label class="ep-device-chip selected" data-custom-idx="${i}">
        <span>${d.name} (${d.width}×${d.height})</span>
        <button type="button" class="ep-btn" style="padding:0.1rem 0.35rem;font-size:0.65rem;margin-left:0.25rem;" data-remove-custom="${i}" aria-label="Remove ${d.name}">✕</button>
      </label>
    `).join('');

    grid.innerHTML = presetHtml + customHtml;

    grid.querySelectorAll('input[type="checkbox"]').forEach(inp => {
      inp.addEventListener('change', () => {
        if (inp.checked) this.selectedDevices.add(inp.value);
        else this.selectedDevices.delete(inp.value);
        inp.closest('.ep-device-chip')?.classList.toggle('selected', inp.checked);
        this.updateWarnings();
      });
    });

    grid.querySelectorAll('[data-remove-custom]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number(btn.dataset.removeCustom);
        this.customDevices.splice(idx, 1);
        this.renderDeviceGrid();
        this.updateWarnings();
        Toast.info('Custom device removed');
      });
    });
  }

  addCustomDevice() {
    const name = document.getElementById('customDeviceName')?.value?.trim();
    const w = Number(document.getElementById('customWidth')?.value);
    const h = Number(document.getElementById('customHeight')?.value);
    if (!name || !w || !h) { Toast.warning('Enter custom device name, width, and height'); return; }
    this.customDevices.push({ name, width: w, height: h });
    Toast.success(`Added custom device: ${name}`);
    document.getElementById('customDeviceName').value = '';
    document.getElementById('customWidth').value = '';
    document.getElementById('customHeight').value = '';
    this.renderDeviceGrid();
    this.updateWarnings();
  }

  bindBrowsers() {
    const group = document.getElementById('browserGroup');
    if (!group) return;
    group.innerHTML = this.browsers.map(b => `
      <label class="ep-browser-option ${b.id === this.selectedBrowser ? 'selected' : ''}">
        <input type="radio" name="browser" value="${b.id}" ${b.id === this.selectedBrowser ? 'checked' : ''}>
        ${b.label}
      </label>
    `).join('');

    group.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('change', () => {
        this.selectedBrowser = inp.value;
        group.querySelectorAll('.ep-browser-option').forEach(l => l.classList.remove('selected'));
        inp.closest('.ep-browser-option')?.classList.add('selected');
        this.updateWarnings();
      });
    });
  }

  updateWarnings() {
    const multi = document.getElementById('multiDeviceWarn');
    const browser = document.getElementById('browserWarn');
    const count = this.deviceCount;

    if (multi) {
      const show = this.mode === 'full' && count > 1;
      multi.classList.toggle('hidden', !show);
      if (show) {
        multi.textContent = 'The test may fail or take significantly longer when multiple devices are selected. For best reliability, run one device at a time.';
      }
    }

    if (browser) {
      const show = this.selectedBrowser === 'firefox' || this.selectedBrowser === 'safari';
      browser.classList.toggle('hidden', !show);
      if (show) {
        browser.textContent = 'There is a higher chance of execution failures with this browser. If possible, use Chromium-based browsers.';
      }
    }
  }

  updateWorkflowState(status) {
    const exec = document.getElementById('executionPanel');
    const results = document.getElementById('resultsPanel');
    const logs = document.getElementById('liveLogsCard');
    const root = document.getElementById('ep-ui-testing');
    const s = status?.status || 'idle';

    const isRunning = s === 'running' || s === 'pending';
    const isTerminal = s === 'completed' || s === 'failed';
    const isIdle = !status || s === 'idle' || s === 'cancelled';

    exec?.classList.toggle('hidden', !isRunning);
    results?.classList.toggle('hidden', !isTerminal);
    logs?.classList.toggle('hidden', isIdle);

    root?.classList.toggle('ep-ui-testing--running', isRunning);
    root?.classList.toggle('ep-ui-testing--complete', isTerminal);
  }

  parseReportSummary(reportPayload, status) {
    const entries = Array.isArray(reportPayload)
      ? reportPayload
      : (reportPayload?.data || reportPayload?.pages || []);
    let pages = status?.totalPages || 0;
    let checks = 0;
    let issues = 0;

    if (Array.isArray(entries) && entries.length) {
      pages = entries.length;
      checks = entries.length;
      issues = entries.reduce((sum, e) => sum + (Array.isArray(e.issues) ? e.issues.length : 0), 0);
    } else if (status?.totalPages > 0) {
      pages = status.totalPages;
      checks = status.totalPages;
    } else if (status?.status === 'completed') {
      checks = this.deviceCount || 1;
      pages = 1;
    }

    return { pages, checks, issues };
  }

  renderResultsStats(stats) {
    const el = document.getElementById('resultsStats');
    if (!el) return;
    el.innerHTML = `
      <div class="ep-ui-testing-stat">
        <div class="ep-ui-testing-stat-value">${stats.pages}</div>
        <div class="ep-ui-testing-stat-label">Pages Scanned</div>
      </div>
      <div class="ep-ui-testing-stat">
        <div class="ep-ui-testing-stat-value">${stats.checks}</div>
        <div class="ep-ui-testing-stat-label">Checks Run</div>
      </div>
      <div class="ep-ui-testing-stat">
        <div class="ep-ui-testing-stat-value ${stats.issues > 0 ? 'has-issues' : ''}">${stats.issues}</div>
        <div class="ep-ui-testing-stat-label">Issues Found</div>
      </div>
    `;
  }

  renderResultsStatus(status) {
    const el = document.getElementById('resultsStatus');
    if (!el || !status) return;
    const cls = status === 'completed' ? 'status-completed' : 'status-failed';
    el.innerHTML = `<span class="job-status-badge ${cls}">${status}</span>`;
  }

  /** PERFORMANCE: batched log append with DOM node cap (max 500 lines) */
  appendLog(msg) {
    if (this.logsFrozen) return;
    const panel = document.getElementById('liveLogs');
    if (!panel) return;
    if (panel.querySelector('.ep-log-line')?.textContent === 'Waiting for execution...') {
      panel.innerHTML = '';
    }
    const line = document.createElement('div');
    line.className = 'ep-log-line';
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    panel.appendChild(line);
    // PERFORMANCE: cap DOM nodes at 500, remove oldest if over limit
    while (panel.children.length > 500) {
      panel.removeChild(panel.firstChild);
    }
    panel.scrollTop = panel.scrollHeight;
  }

  async updateResults(status, reportModuleId) {
    const panel = document.getElementById('resultsPanel');
    const body = document.getElementById('resultsBody');
    const actions = document.getElementById('resultsActions');
    if (!panel || !body || !actions || !status) return;

    if (!['completed', 'failed'].includes(status.status)) {
      return;
    }

    const modId = reportModuleId || this.moduleId;
    this.updateWorkflowState(status);
    this.renderResultsStatus(status.status);

    let stats = this.parseReportSummary(null, status);
    if (status.status === 'completed' && status.reportAvailable && status.jobId) {
      try {
        const report = await ModuleAPI.getReport(modId, `job:${status.jobId}`);
        stats = this.parseReportSummary(report.data, status);
      } catch { /* use fallback stats */ }
    }

    this.renderResultsStats(stats);

    const duration = status.durationMs ? `${Math.round(status.durationMs / 1000)}s` : '—';
    body.innerHTML = `<div>Duration: <strong>${duration}</strong></div>`;
    if (status.error) {
      body.innerHTML += `<div style="color:var(--ep-error);margin-top:0.35rem;">${this.escHtml(status.error)}</div>`;
    }

    actions.innerHTML = '';
    if (status.status === 'completed' && status.reportAvailable) {
      const view = document.createElement('button');
      view.className = 'ep-btn ep-btn-primary ep-ui-testing-btn';
      view.textContent = 'View Report';
      view.onclick = () => window.open(ModuleAPI.jobReportUrl(modId, status.jobId), '_blank');
      actions.appendChild(view);

      const rerun = document.createElement('button');
      rerun.className = 'ep-btn ep-ui-testing-btn';
      rerun.textContent = 'Re-run Test';
      rerun.onclick = () => this.runner.start();
      actions.appendChild(rerun);
    } else if (status.status === 'failed') {
      const logs = document.createElement('button');
      logs.className = 'ep-btn ep-ui-testing-btn';
      logs.textContent = 'View Logs';
      logs.onclick = async () => {
        try {
          const { job } = await ModuleAPI.getJob(modId, status.jobId);
          LogsDrawer.open((job.logs || []).map(l => ({ ...l, type: 'info' })));
        } catch {
          LogsDrawer.open([{ at: new Date().toISOString(), type: 'error', message: status.error || 'Check live logs panel' }]);
        }
      };
      actions.appendChild(logs);

      const rerun = document.createElement('button');
      rerun.className = 'ep-btn ep-ui-testing-btn';
      rerun.textContent = 'Re-run Test';
      rerun.onclick = () => this.runner.start();
      actions.appendChild(rerun);
    }

    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s ?? '';
    return d.innerHTML;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  window.__uiTestingApp = new UITestingApp();
  await window.__uiTestingApp.init();
});