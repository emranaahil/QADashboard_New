const ReportsApp = {
  tab: 'recent',
  pinnedKey: 'qa:pinned-reports',
  favKey: 'qa:favorite-reports',

  async init() {
    await EnterpriseShell.mount({
      title: 'Reports Center',
      subtitle: 'Recent, pinned, and favorite reports',
      activePath: '/reports'
    });

    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.tab = btn.dataset.tab;
        this.render();
      });
    });

    await this.load();
  },

  getStored(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  },

  setStored(key, arr) {
    localStorage.setItem(key, JSON.stringify(arr));
  },

  reportKey(r) {
    return `${r.moduleId}:${r.id}`;
  },

  async load() {
    try {
      this.reports = await QueryCache.fetch('reports:center', () => ModuleAPI.getReportsCenter({ limit: 200 }), 20000);
      this.render();
    } catch (err) {
      document.getElementById('reports-list').innerHTML = `<p class="ep-warning">${err.message}</p>`;
    }
  },

  render() {
    const el = document.getElementById('reports-list');
    const pinned = this.getStored(this.pinnedKey);
    const favorites = this.getStored(this.favKey);

    let list = this.reports?.reports || [];
    if (this.tab === 'pinned') {
      list = list.filter(r => pinned.includes(this.reportKey(r)));
    } else if (this.tab === 'favorites') {
      list = list.filter(r => favorites.includes(this.reportKey(r)));
    }

    if (!list.length) {
      el.innerHTML = `<p class="ep-empty">No ${this.tab} reports.</p>`;
      return;
    }

    el.innerHTML = list.map(r => {
      const key = this.reportKey(r);
      const isPinned = pinned.includes(key);
      const isFav = favorites.includes(key);
      const htmlUrl = r.id?.startsWith('job:')
        ? ModuleAPI.jobReportUrl(r.moduleId, r.id.replace('job:', ''))
        : ModuleAPI.htmlReportUrl(r.moduleId, r.id);

      return `<div class="ep-report-card" data-key="${key}">
        <div class="ep-report-card-main">
          <div class="ep-history-report-title">${this.esc(r.title || r.id)}</div>
          <div class="ep-history-report-meta">${r.moduleIcon || ''} ${r.moduleName} · ${r.generatedAt ? new Date(r.generatedAt).toLocaleString() : ''}</div>
        </div>
        <div class="ep-report-card-actions">
          ${r.hasHtml ? `<a href="${htmlUrl}" target="_blank" class="ep-btn ep-btn-primary ep-btn-link">Open</a>` : ''}
          ${r.hasHtml ? `<a href="${htmlUrl}" download class="ep-btn ep-btn-link">Download</a>` : ''}
          <button type="button" class="ep-btn" data-pin="${key}" aria-pressed="${isPinned}">${isPinned ? 'Unpin' : 'Pin'}</button>
          <button type="button" class="ep-btn" data-fav="${key}" aria-pressed="${isFav}">${isFav ? '★' : '☆'}</button>
        </div>
      </div>`;
    }).join('');

    el.querySelectorAll('[data-pin]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.pin;
        let arr = this.getStored(this.pinnedKey);
        arr = arr.includes(key) ? arr.filter(k => k !== key) : [...arr, key];
        this.setStored(this.pinnedKey, arr);
        Toast.success(arr.includes(key) ? 'Pinned' : 'Unpinned');
        this.render();
      });
    });

    el.querySelectorAll('[data-fav]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.fav;
        let arr = this.getStored(this.favKey);
        arr = arr.includes(key) ? arr.filter(k => k !== key) : [...arr, key];
        this.setStored(this.favKey, arr);
        Toast.success(arr.includes(key) ? 'Added to favorites' : 'Removed from favorites');
        this.render();
      });
    });
  },

  esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
};

document.addEventListener('DOMContentLoaded', () => ReportsApp.init());