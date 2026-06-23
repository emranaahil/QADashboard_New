/**
 * Link Radar — Error Check UI inside enterprise shell content area.
 * Mirrors frontend/modules/error-check/app.js; reuses ReportPanel + renderErrorCheckReport.
 */
class LinkRadarApp {
  constructor() {
    this.moduleId = 'error-check';
    this.pollTimer = null;
    this.panel = null;
  }

  async init() {
    await EnterpriseShell.mount({
      title: 'LinkRadar',
      subtitle: 'Backlinks, broken links, and internal link health',
      activePath: '/linkradar'
    });

    document.getElementById('startBtn')?.addEventListener('click', () => this.start());

    this.panel = new ReportPanel({
      moduleId: this.moduleId,
      listEl: document.getElementById('report-list'),
      viewerEl: document.getElementById('report-viewer'),
      actionsEl: document.getElementById('report-actions'),
      onRender: renderErrorCheckReport
    });
    await this.panel.load();
  }

  show(id) { document.getElementById(id)?.classList.remove('hidden'); }
  hide(id) { document.getElementById(id)?.classList.add('hidden'); }

  async start() {
    const url = document.getElementById('siteUrl').value.trim();
    const maxUrls = parseInt(document.getElementById('maxPages').value, 10) || 100;
    const maxDepth = parseInt(document.getElementById('maxDepth').value, 10) || 5;

    this.hide('errorSection');
    this.show('progressSection');
    document.getElementById('statusLine').textContent = 'Starting...';
    document.getElementById('startBtn').disabled = true;

    this.pollTimer = setInterval(() => this.pollProgress(), 1800);

    try {
      await ModuleAPI.fetchJson('/api/check-broken-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, maxUrls, maxDepth, delay: 400 })
      });
      clearInterval(this.pollTimer);
      document.getElementById('statusLine').textContent = 'Check complete. Report saved.';
      document.getElementById('startBtn').disabled = false;
      await this.panel.load();
    } catch (err) {
      clearInterval(this.pollTimer);
      document.getElementById('errorMessage').textContent = err.message;
      this.show('errorSection');
      document.getElementById('startBtn').disabled = false;
    }
  }

  async pollProgress() {
    try {
      const p = await ModuleAPI.fetchJson('/api/check-broken-pages/status?t=' + Date.now());
      if (p.stats) {
        document.getElementById('urlsProcessed').textContent = p.stats.urlsProcessed || 0;
        document.getElementById('errorCount').textContent = p.stats.errorCount || 0;
      }
      if (p.currentUrl) {
        document.getElementById('currentUrl').textContent = 'Checking: ' + p.currentUrl;
      }
    } catch { /* ignore poll errors */ }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new LinkRadarApp();
  app.init();
});