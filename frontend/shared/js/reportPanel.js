/**
 * Reusable report list + viewer panel. Each module passes its own renderReport() callback.
 */
class ReportPanel {
  constructor({ moduleId, listEl, viewerEl, actionsEl, onRender }) {
    this.moduleId = moduleId;
    this.listEl = listEl;
    this.viewerEl = viewerEl;
    this.actionsEl = actionsEl;
    this.onRender = onRender;
    this.reports = [];
    this.activeId = null;
  }

  showError(message) {
    if (this.viewerEl) {
      this.viewerEl.innerHTML = `<div class="alert alert-error">${this.escape(message)}</div>`;
    }
  }

  showEmpty(message) {
    if (this.viewerEl) {
      this.viewerEl.innerHTML = `<div class="alert alert-empty">${this.escape(message)}</div>`;
    }
    if (this.listEl) this.listEl.innerHTML = '<li class="alert-empty" style="list-style:none;padding:0.75rem;">No saved reports</li>';
  }

  escape(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  async load() {
    try {
      const data = await ModuleAPI.listReports(this.moduleId);
      this.reports = data.reports || [];
      this.renderList();
      if (this.reports.length) {
        await this.select(this.reports[0].id);
      } else {
        this.showEmpty('No reports found for this module. Run a scan to generate one.');
      }
    } catch (err) {
      this.showEmpty(err.message || 'Failed to load reports');
    }
  }

  renderList() {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';
    this.reports.forEach(r => {
      const li = document.createElement('li');
      li.className = r.id === this.activeId ? 'active' : '';
      li.innerHTML = `${this.escape(r.title || r.id)}<span class="report-date">${r.generatedAt ? new Date(r.generatedAt).toLocaleString() : ''}</span>`;
      li.onclick = () => this.select(r.id);
      this.listEl.appendChild(li);
    });
  }

  renderActions(report) {
    if (!this.actionsEl) return;
    this.actionsEl.innerHTML = '';
    if (report?.hasHtml) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-outline';
      btn.textContent = '📄 View HTML Report';
      btn.onclick = () => this.showHtml();
      this.actionsEl.appendChild(btn);
    }
    if (report?.hasPdf) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-outline';
      btn.textContent = '📥 Download PDF';
      btn.onclick = () => window.open(ModuleAPI.pdfReportUrl(this.moduleId, report.id), '_blank');
      this.actionsEl.appendChild(btn);
    }
  }

  showHtml() {
    if (!this.viewerEl) return;
    const url = ModuleAPI.htmlReportUrl(this.moduleId, this.activeId === 'latest-html' ? null : this.activeId);
    this.viewerEl.innerHTML = `<iframe src="${url}" title="HTML Report"></iframe>`;
  }

  async select(reportId) {
    this.activeId = reportId;
    this.renderList();
    const meta = this.reports.find(r => r.id === reportId);
    this.renderActions(meta);

    try {
      const result = await ModuleAPI.getReport(this.moduleId, reportId);
      if (this.onRender) {
        this.onRender(result, this.viewerEl, meta);
      }
    } catch (err) {
      this.showError(err.message || 'Failed to load report');
    }
  }

  async loadLatest() {
    try {
      const result = await ModuleAPI.getLatestReport(this.moduleId);
      if (this.onRender && this.viewerEl) {
        this.onRender(result, this.viewerEl, result.meta);
      }
    } catch (err) {
      this.showEmpty(err.message);
    }
  }
}

window.ReportPanel = ReportPanel;