/**
 * Keyword Radar — Keyword Check UI inside enterprise shell content area.
 * Mirrors frontend/modules/keyword-check/app.js; reuses ReportPanel + renderKeywordReport.
 */
class KeywordRadarApp {
  constructor() {
    this.moduleId = 'keyword-check';
    this.scanId = null;
    this.pollTimer = null;
    this.panel = null;
  }

  bind() {
    document.getElementById('startScanBtn')?.addEventListener('click', () => this.startScan());
    document.getElementById('clearBtn')?.addEventListener('click', () => this.clear());
    document.getElementById('retryBtn')?.addEventListener('click', () => this.startScan());
  }

  async init() {
    await EnterpriseShell.mount({
      title: 'Keyword Radar',
      subtitle: 'Track rankings, volume, and competitor gaps',
      activePath: '/keyword-radar'
    });

    this.bind();

    this.panel = new ReportPanel({
      moduleId: this.moduleId,
      listEl: document.getElementById('report-list'),
      viewerEl: document.getElementById('report-viewer'),
      actionsEl: document.getElementById('report-actions'),
      onRender: renderKeywordReport
    });
    await this.panel.load();
  }

  show(id) { document.getElementById(id)?.classList.remove('hidden'); }
  hide(id) { document.getElementById(id)?.classList.add('hidden'); }

  showError(msg) {
    document.getElementById('errorMessage').textContent = msg;
    this.show('errorSection');
    this.hide('progressSection');
  }

  async startScan() {
    const url = document.getElementById('websiteUrl').value.trim();
    const keywords = document.getElementById('keywords').value.split('\n').map(k => k.trim()).filter(Boolean);
    if (!url) return this.showError('Please enter a website URL');
    if (!keywords.length) return this.showError('Please enter at least one keyword');

    this.hide('errorSection');
    this.show('progressSection');
    document.getElementById('startScanBtn').disabled = true;

    try {
      const data = await ModuleAPI.fetchJson('/api/scan/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, keywords })
      });
      this.scanId = data.scanId;
      this.pollTimer = setInterval(() => this.pollStatus(), 2000);
    } catch (err) {
      this.showError(err.message);
      document.getElementById('startScanBtn').disabled = false;
    }
  }

  async pollStatus() {
    if (!this.scanId) return;
    try {
      const data = await ModuleAPI.fetchJson(`/api/scan/${this.scanId}/status`);
      const stats = data.stats || {};
      document.getElementById('urlsDiscovered').textContent = stats.urlsDiscovered || 0;
      document.getElementById('urlsProcessed').textContent = stats.urlsProcessed || 0;
      document.getElementById('currentBatch').textContent = stats.currentBatch || 0;
      document.getElementById('matchesFound').textContent = stats.matchesFound || 0;
      const pct = stats.urlsDiscovered ? Math.min(100, Math.round((stats.urlsProcessed / stats.urlsDiscovered) * 100)) : 0;
      document.getElementById('progressFill').style.width = pct + '%';
      document.getElementById('progressText').textContent = pct + '%';
      document.getElementById('statusText').textContent = data.status;
      document.getElementById('statusDot').className = 'status-dot running';

      if (data.status === 'completed') {
        clearInterval(this.pollTimer);
        document.getElementById('startScanBtn').disabled = false;
        await this.panel.load();
      } else if (data.status === 'failed') {
        clearInterval(this.pollTimer);
        this.showError(data.error || 'Scan failed');
        document.getElementById('startScanBtn').disabled = false;
      }
    } catch (err) {
      clearInterval(this.pollTimer);
      this.showError(err.message);
      document.getElementById('startScanBtn').disabled = false;
    }
  }

  clear() {
    clearInterval(this.pollTimer);
    this.scanId = null;
    document.getElementById('websiteUrl').value = '';
    document.getElementById('keywords').value = '';
    this.hide('progressSection');
    this.hide('errorSection');
    document.getElementById('startScanBtn').disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new KeywordRadarApp();
  app.init();
});