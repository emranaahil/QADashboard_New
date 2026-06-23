const HistoryApp = {
  expanded: null,

  async init() {
    await EnterpriseShell.mount({
      title: 'History',
      subtitle: 'Past test runs grouped by date',
      activePath: '/history'
    });

    document.getElementById('filterModule')?.addEventListener('change', () => {
      QueryCache.invalidate('history:all');
      this.load();
    });

    const q = new URLSearchParams(location.search).get('q');
    if (q) {
      const search = document.getElementById('ep-global-search');
      if (search) search.value = q;
    }

    await this.load();
  },

  async load() {
    const el = document.getElementById('history-list');
    const moduleId = document.getElementById('filterModule')?.value || '';
    const cacheKey = `history:${moduleId || 'all'}`;

    try {
      const data = await QueryCache.fetch(cacheKey, () =>
        ModuleAPI.getHistory({ limit: 100, moduleId: moduleId || undefined })
      , 10000);

      const q = new URLSearchParams(location.search).get('q')?.toLowerCase();
      let grouped = data.grouped || [];
      if (q) {
        grouped = HistoryApp.filterGrouped(grouped, q);
      }

      if (!grouped.length) {
        el.innerHTML = '<p class="ep-empty">No execution history found.</p>';
        return;
      }

      el.innerHTML = grouped.map(g => `
        <section class="ep-history-group">
          <h3 class="ep-history-date">${g.date}</h3>
          ${g.runs.map(run => HistoryApp.renderRun(run)).join('')}
        </section>
      `).join('');

      el.querySelectorAll('[data-expand]').forEach(row => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.ep-overflow-menu')) return;
          HistoryApp.toggleExpand(row.dataset.jobId, row.dataset.moduleId);
        });
      });

      el.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Delete this history entry?')) return;
          try {
            await ModuleAPI.deleteHistoryEntry(btn.dataset.moduleId, btn.dataset.jobId);
            Toast.success('Deleted');
            QueryCache.invalidate();
            await HistoryApp.load();
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
          btn.closest('.ep-overflow-menu')?.classList.toggle('open');
        });
      });
    } catch (err) {
      el.innerHTML = `<p class="ep-warning">${err.message}</p>`;
    }
  },

  filterGrouped(grouped, q) {
    return grouped
      .map(g => ({
        ...g,
        runs: g.runs.filter(r =>
          (r.url || '').toLowerCase().includes(q) ||
          (r.moduleId || '').toLowerCase().includes(q) ||
          (r.status || '').toLowerCase().includes(q)
        )
      }))
      .filter(g => g.runs.length);
  },

  renderRun(run) {
    const canReport = run.status === 'completed' && run.reportAvailable;
    const isFailed = run.status === 'failed' || run.status === 'cancelled';
    const expanded = this.expanded === `${run.moduleId}:${run.id}`;

    return `
      <div class="ep-history-row ${expanded ? 'expanded' : ''}" data-expand data-job-id="${run.id}" data-module-id="${run.moduleId}">
        <div class="ep-history-row-main">
          <div class="ep-history-report-title">${this.esc(run.url)}</div>
          <div class="ep-history-report-meta">${run.moduleLabel || run.moduleId} · ${run.durationMs ? Math.round(run.durationMs / 1000) + 's' : '—'}</div>
        </div>
        <span class="ep-status-pill ${run.status}">${run.status}</span>
        <div class="ep-overflow-menu">
          <button type="button" class="ep-btn ep-overflow-btn" aria-label="More actions">⋯</button>
          <div class="ep-overflow-dropdown">
            ${canReport ? `<button type="button" data-view-report data-module-id="${run.moduleId}" data-job-id="${run.id}">View Report</button>` : ''}
            ${isFailed ? `<button type="button" data-view-logs data-module-id="${run.moduleId}" data-job-id="${run.id}">View Logs</button>` : ''}
            <button type="button" class="danger" data-delete data-module-id="${run.moduleId}" data-job-id="${run.id}">Delete</button>
          </div>
        </div>
      </div>
      ${expanded ? `<div class="ep-history-detail" id="detail-${run.id}">
        <div>Created: ${new Date(run.createdAt).toLocaleString()}</div>
        <div>Message: ${this.esc(run.message || '—')}</div>
        ${run.error ? `<div style="color:var(--ep-error);">Error: ${this.esc(run.error)}</div>` : ''}
        <div class="ep-btn-row ep-history-detail-actions">
          ${canReport ? `<button class="ep-btn ep-btn-primary" data-view-report data-module-id="${run.moduleId}" data-job-id="${run.id}">View Report</button>` : ''}
          ${isFailed ? `<button class="ep-btn" data-view-logs data-module-id="${run.moduleId}" data-job-id="${run.id}">View Logs</button>` : ''}
        </div>
      </div>` : ''}
    `;
  },

  toggleExpand(jobId, moduleId) {
    const key = `${moduleId}:${jobId}`;
    this.expanded = this.expanded === key ? null : key;
    this.load();
  },

  esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
};

document.addEventListener('DOMContentLoaded', () => HistoryApp.init());