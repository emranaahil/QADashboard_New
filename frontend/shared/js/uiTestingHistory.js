/**
 * UI Testing history panel — server-filtered by test type, grouped by date.
 */
const UiTestingHistory = {
  testType: 'single-page',
  searchQuery: '',
  collapsedDates: new Set(),
  selectedJobId: null,
  _searchTimer: null,
  _loading: false,
  onSelectReport: null,

  HEADINGS: {
    'single-page': 'Single Page History',
    'full-website': 'Full Website History'
  },

  EMPTY_MESSAGES: {
    'single-page': 'No Single Page reports found',
    'full-website': 'No Full Website reports found'
  },

  init({ testType, onSelectReport } = {}) {
    this.testType = testType || 'single-page';
    this.onSelectReport = onSelectReport || null;
    this.bindControls();
    this.syncHeading();
    return this.load(true);
  },

  bindControls() {
    const search = document.getElementById('historySearch');

    search?.addEventListener('input', () => {
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        this.searchQuery = search.value.trim();
        this.invalidateCache();
        this.load();
      }, 300);
    });
  },

  setTestType(type) {
    if (this.testType === type) return;
    this.testType = type;
    this.selectedJobId = null;
    this.syncHeading();
    this.syncFilterDropdown();
    this.invalidateCache();
    return this.load();
  },

  syncHeading() {
    const heading = document.getElementById('historyHeading');
    if (heading) {
      heading.textContent = this.HEADINGS[this.testType] || 'History';
    }
  },

  syncFilterDropdown() {
    const filter = document.getElementById('historyTypeFilter');
    if (filter && filter.value !== this.testType) {
      filter.value = this.testType;
    }
  },

  invalidateCache() {
    QueryCache.invalidate(this.cacheKey());
  },

  cacheKey() {
    return QueryCache.key(['ui-testing-history', this.testType, this.searchQuery || '']);
  },

  async refresh(force = true) {
    if (force) this.invalidateCache();
    return this.load();
  },

  async load(force = false) {
    const el = document.getElementById('job-history');
    if (!el) return;

    if (this._loading && !force) return;
    this._loading = true;

    if (!el.querySelector('.ep-history-group') && !el.querySelector('.ep-empty')) {
      el.innerHTML = '<div class="ep-skeleton" style="height:3rem;"></div>';
    }

    try {
      const data = await QueryCache.fetch(
        this.cacheKey(),
        () => ModuleAPI.getUiTestingHistory({
          type: this.testType,
          q: this.searchQuery || undefined,
          limit: 100
        }),
        10000
      );

      this.render(el, data);
    } catch (err) {
      el.innerHTML = `<p class="ep-warning" role="alert">${this.esc(err.message || 'Failed to load history')}</p>`;
    } finally {
      this._loading = false;
    }
  },

  computeStats(items = []) {
    let completed = 0;
    let failed = 0;
    let running = 0;
    for (const item of items) {
      if (item.status === 'completed') completed++;
      else if (item.status === 'failed' || item.status === 'cancelled') failed++;
      else if (item.status === 'running' || item.status === 'pending') running++;
    }
    return { total: items.length, completed, failed, running };
  },

  renderStats(data) {
    const el = document.getElementById('historyStats');
    if (!el) return;
    const items = data?.items || [];
    const stats = this.computeStats(items);

    if (!stats.total) {
      el.innerHTML = '';
      return;
    }

    el.innerHTML = `
      <div class="ep-ui-testing-mini-stat">
        <div class="ep-ui-testing-mini-stat-value">${stats.total}</div>
        <div class="ep-ui-testing-mini-stat-label">Total</div>
      </div>
      <div class="ep-ui-testing-mini-stat">
        <div class="ep-ui-testing-mini-stat-value is-info">${stats.running}</div>
        <div class="ep-ui-testing-mini-stat-label">Running</div>
      </div>
      <div class="ep-ui-testing-mini-stat">
        <div class="ep-ui-testing-mini-stat-value is-success">${stats.completed}</div>
        <div class="ep-ui-testing-mini-stat-label">Completed</div>
      </div>
      <div class="ep-ui-testing-mini-stat">
        <div class="ep-ui-testing-mini-stat-value is-error">${stats.failed}</div>
        <div class="ep-ui-testing-mini-stat-label">Failed</div>
      </div>
    `;
  },

  syncSubheading(total) {
    const sub = document.getElementById('historySubheading');
    if (!sub) return;
    const label = this.testType === 'full-website' ? 'Full website' : 'Single page';
    sub.textContent = total
      ? `${total} saved ${label.toLowerCase()} report${total === 1 ? '' : 's'}`
      : `Past ${label.toLowerCase()} test runs`;
  },

  renderEmptyState(message, isSearch) {
    const title = isSearch ? 'No matching reports' : 'No reports yet';
    const desc = isSearch
      ? message
      : 'Run a test above to generate your first report. Completed runs appear here automatically.';
    return `
      <div class="ep-ui-testing-empty" role="status">
        <p class="ep-ui-testing-empty-title">${this.esc(title)}</p>
        <p class="ep-ui-testing-empty-desc">${this.esc(desc)}</p>
      </div>
    `;
  },

  formatReportTime(item) {
    const raw = item.completedAt || item.createdAt;
    if (!raw) return '';
    try {
      return new Date(raw).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  },

  render(el, data) {
    const grouped = data?.grouped || [];
    const items = data?.items || [];
    this.renderStats(data);
    this.syncSubheading(items.length);

    const emptyMsg = this.searchQuery
      ? `${this.EMPTY_MESSAGES[this.testType] || 'No reports found'} for "${this.esc(this.searchQuery)}"`
      : (this.EMPTY_MESSAGES[this.testType] || 'No reports found');

    if (!grouped.length) {
      el.innerHTML = this.renderEmptyState(emptyMsg, !!this.searchQuery);
      return;
    }

    el.innerHTML = grouped.map(g => this.renderDateGroup(g)).join('');
    this.bindGroupEvents(el);
  },

  renderDateGroup(group) {
    const collapsed = this.collapsedDates.has(group.date);
    const chevron = collapsed ? '▶' : '▼';

    const reportsHtml = group.reports.map(r => this.renderReport(r)).join('');

    return `
      <section class="ep-history-group" data-date-group="${group.date}">
        <button type="button" class="ep-history-date-toggle" data-date="${group.date}" aria-expanded="${!collapsed}">
          <span class="ep-history-chevron" aria-hidden="true">${chevron}</span>
          <span class="ep-history-date-label">${this.esc(group.dateLabel || group.date)}</span>
          <span class="ep-history-count">${group.reports.length}</span>
        </button>
        <div class="ep-history-date-body ${collapsed ? 'collapsed' : ''}">
          ${reportsHtml}
        </div>
      </section>
    `;
  },

  renderReport(item) {
    const selected = this.selectedJobId === item.id;
    const label = item.title || item.url || item.id;
    const duration = item.durationMs ? `${Math.round(item.durationMs / 1000)}s` : '—';
    const time = this.formatReportTime(item);
    const metaParts = [duration !== '—' ? duration : null, time || null].filter(Boolean);

    return `
      <div class="ep-history-row ${selected ? 'selected' : ''}" role="listitem"
           data-select-report data-job-id="${item.id}" data-module-id="${item.moduleId}">
        <div class="ep-history-row-main">
          <div class="ep-history-report-title">${this.esc(label)}</div>
          <div class="ep-history-report-meta">${this.esc(item.url || '')}</div>
          ${metaParts.length ? `<div class="ep-history-report-time">${metaParts.join(' · ')}</div>` : ''}
        </div>
        <span class="ep-status-pill ${item.status}">${item.status}</span>
        <div class="ep-overflow-menu">
          <button type="button" class="ep-btn ep-overflow-btn" aria-label="More actions">⋯</button>
          <div class="ep-overflow-dropdown">
            ${item.status === 'completed' && item.reportAvailable
              ? `<button type="button" data-view-report data-module-id="${item.moduleId}" data-job-id="${item.id}">View Report</button>`
              : ''}
            ${item.status === 'failed' || item.status === 'cancelled'
              ? `<button type="button" data-view-logs data-module-id="${item.moduleId}" data-job-id="${item.id}">View Logs</button>`
              : ''}
            <button type="button" class="danger" data-delete data-module-id="${item.moduleId}" data-job-id="${item.id}">Delete</button>
          </div>
        </div>
      </div>
    `;
  },

  bindGroupEvents(el) {
    el.querySelectorAll('[data-date]').forEach(btn => {
      btn.addEventListener('click', () => {
        const date = btn.dataset.date;
        if (this.collapsedDates.has(date)) {
          this.collapsedDates.delete(date);
        } else {
          this.collapsedDates.add(date);
        }
        this.load(true);
      });
    });

    el.querySelectorAll('[data-select-report]').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.ep-overflow-menu')) return;
        const jobId = row.dataset.jobId;
        const moduleId = row.dataset.moduleId;
        this.selectedJobId = jobId;
        el.querySelectorAll('.ep-history-row.selected').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        this.onSelectReport?.({ id: jobId, moduleId, testType: this.testType });
      });
    });

    el.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this report from history?')) return;
        try {
          await ModuleAPI.deleteUiTestingHistory(btn.dataset.jobId, this.testType);
          if (this.selectedJobId === btn.dataset.jobId) this.selectedJobId = null;
          Toast.success('Deleted');
          this.invalidateCache();
          await this.load(true);
          document.dispatchEvent(new CustomEvent('qa:history-deleted', {
            detail: { jobId: btn.dataset.jobId, testType: this.testType }
          }));
        } catch (err) {
          Toast.error(err.message);
        }
      });
    });

    el.querySelectorAll('[data-view-report]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(ModuleAPI.jobReportUrl(btn.dataset.moduleId, btn.dataset.jobId), '_blank');
      });
    });

    el.querySelectorAll('[data-view-logs]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const { job } = await ModuleAPI.getJob(btn.dataset.moduleId, btn.dataset.jobId);
          LogsDrawer.open((job.logs || []).map(l => ({ ...l, type: 'info' })));
        } catch (err) {
          Toast.error(err.message);
        }
      });
    });

    el.querySelectorAll('.ep-overflow-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        el.querySelectorAll('.ep-overflow-menu.open').forEach(m => {
          if (m !== btn.closest('.ep-overflow-menu')) m.classList.remove('open');
        });
        btn.closest('.ep-overflow-menu')?.classList.toggle('open');
      });
    });
  },

  esc(s) {
    const d = document.createElement('div');
    d.textContent = s ?? '';
    return d.innerHTML;
  }
};

window.UiTestingHistory = UiTestingHistory;