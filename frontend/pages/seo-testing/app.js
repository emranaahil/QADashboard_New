/**
 * Enterprise SEO Testing — wraps existing seo job runner.
 */
class SeoTestingApp {
  constructor() {
    this.mode = 'single';
    this.runner = null;
  }

  async init() {
    await EnterpriseShell.mount({
      title: 'SEO Testing',
      subtitle: 'Meta tags, structured data, accessibility, and performance',
      activePath: '/seo-testing'
    });

    this.bindMode();
    this.runner = new JobRunner({ moduleId: 'seo' });
    this.patchRunner();
    await this.runner.init();
  }

  patchRunner() {
    const origGetOpts = this.runner.getJobOptions.bind(this.runner);
    this.runner.getJobOptions = () => ({ mode: this.mode, ...origGetOpts() });

    const origApply = this.runner.applyStatus.bind(this.runner);
    this.runner.applyStatus = (status) => {
      origApply(status);
      this.onStatus(status);
    };
  }

  onStatus(status) {
    const state = status?.status === 'running' ? 'running'
      : status?.status === 'completed' ? 'success'
        : status?.status === 'failed' ? 'failed' : 'idle';
    EnterpriseShell.setExecutionStatus(state);
    this.updateResults(status);

    if (status?.status === 'failed' && status?.error) {
      LogsDrawer.setLogs([{ at: new Date().toISOString(), type: 'error', message: status.error }]);
    }
  }

  bindMode() {
    document.getElementById('modeSingle')?.addEventListener('click', () => this.setMode('single'));
    document.getElementById('modeFull')?.addEventListener('click', () => this.setMode('full'));
  }

  setMode(mode) {
    this.mode = mode;
    document.getElementById('modeSingle')?.classList.toggle('active', mode === 'single');
    document.getElementById('modeFull')?.classList.toggle('active', mode === 'full');
    document.getElementById('modeSingle')?.setAttribute('aria-selected', mode === 'single');
    document.getElementById('modeFull')?.setAttribute('aria-selected', mode === 'full');
    document.getElementById('urlLabel').textContent = mode === 'full' ? 'Website URL' : 'URL';
    document.getElementById('runJobBtn').textContent = mode === 'full' ? 'Run Full Website SEO Test' : 'Run SEO Test';

    const est = document.getElementById('pageEstimate');
    if (est) {
      if (mode === 'full') {
        est.classList.remove('hidden');
        est.textContent = 'Full website mode will auto-discover sitemap and estimate page count before execution.';
      } else {
        est.classList.add('hidden');
      }
    }
  }

  updateResults(status) {
    const panel = document.getElementById('resultsPanel');
    const body = document.getElementById('resultsBody');
    const actions = document.getElementById('resultsActions');
    if (!panel || !body || !actions || !status) return;

    if (!['completed', 'failed'].includes(status.status)) {
      panel.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');
    body.innerHTML = `
      <div>Status: <strong>${status.status}</strong></div>
      <div>Progress: ${status.progress || 0}%</div>
    `;
    actions.innerHTML = '';

    if (status.status === 'completed' && status.reportAvailable) {
      const view = document.createElement('button');
      view.className = 'ep-btn ep-btn-primary';
      view.textContent = 'View Report';
      view.onclick = () => this.runner.openReport(status.jobId);
      actions.appendChild(view);
    } else if (status.status === 'failed') {
      const logs = document.createElement('button');
      logs.className = 'ep-btn';
      logs.textContent = 'View Logs';
      logs.onclick = async () => {
        try {
          const { job } = await ModuleAPI.getJob('seo', status.jobId);
          LogsDrawer.open((job.logs || []).map(l => ({ ...l, type: 'info' })));
        } catch {
          LogsDrawer.open([{ at: new Date().toISOString(), type: 'error', message: status.error || 'Unknown error' }]);
        }
      };
      actions.appendChild(logs);
    }

    const rerun = document.createElement('button');
    rerun.className = 'ep-btn';
    rerun.textContent = 'Re-run Test';
    rerun.onclick = () => this.runner.start();
    actions.appendChild(rerun);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  window.__seoApp = new SeoTestingApp();
  await window.__seoApp.init();
  window.__jobRunner = window.__seoApp.runner;
});