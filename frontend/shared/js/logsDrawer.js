/**
 * Right-side logs drawer — search, filter, copy, export.
 */
const LogsDrawer = {
  el: null,
  logs: [],
  filtered: [],

  init() {
    if (this.el) return;
    const drawer = document.createElement('aside');
    drawer.id = 'ep-logs-drawer';
    drawer.className = 'ep-drawer';
    drawer.setAttribute('aria-label', 'Execution logs');
    drawer.innerHTML = `
      <div class="ep-drawer-header">
        <h2>Logs</h2>
        <button type="button" class="ep-btn ep-drawer-close" aria-label="Close logs">✕</button>
      </div>
      <div class="ep-drawer-toolbar">
        <input type="search" id="ep-logs-search" class="ep-input" placeholder="Search logs..." aria-label="Search logs">
        <select id="ep-logs-filter" class="ep-select" aria-label="Filter by status">
          <option value="all">All</option>
          <option value="info">Info</option>
          <option value="error">Error</option>
        </select>
        <button type="button" id="ep-logs-copy" class="ep-btn">Copy</button>
        <button type="button" id="ep-logs-export" class="ep-btn">Export</button>
      </div>
      <div id="ep-logs-body" class="ep-drawer-body"></div>
    `;
    document.body.appendChild(drawer);
    this.el = drawer;

    drawer.querySelector('.ep-drawer-close')?.addEventListener('click', () => this.close());
    document.getElementById('ep-logs-search')?.addEventListener('input', () => this.render());
    document.getElementById('ep-logs-filter')?.addEventListener('change', () => this.render());
    document.getElementById('ep-logs-copy')?.addEventListener('click', () => this.copy());
    document.getElementById('ep-logs-export')?.addEventListener('click', () => this.export());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) this.close();
    });
  },

  isOpen() {
    return this.el?.classList.contains('open');
  },

  open(logs = []) {
    this.init();
    this.logs = Array.isArray(logs) ? logs : [];
    if (!this.logs.length) {
      this.logs = [{ at: new Date().toISOString(), message: 'No logs available', type: 'info' }];
    }
    this.el.classList.add('open');
    this.render();
    this.el.querySelector('.ep-drawer-close')?.focus();
  },

  close() {
    this.el?.classList.remove('open');
  },

  setLogs(logs) {
    this.logs = logs || [];
    if (this.isOpen()) this.render();
  },

  render() {
    const body = document.getElementById('ep-logs-body');
    if (!body) return;

    const q = (document.getElementById('ep-logs-search')?.value || '').toLowerCase();
    const filter = document.getElementById('ep-logs-filter')?.value || 'all';

    this.filtered = this.logs.filter(l => {
      const type = l.type || 'info';
      if (filter !== 'all' && type !== filter) return false;
      const msg = `${l.at || ''} ${l.message || ''}`.toLowerCase();
      return !q || msg.includes(q);
    });

    body.innerHTML = this.filtered.map(l => `
      <div class="ep-drawer-log" data-type="${l.type || 'info'}">
        <time>${l.at ? new Date(l.at).toLocaleTimeString() : '—'}</time>
        <span class="ep-drawer-log-type">${l.type || 'info'}</span>
        <span class="ep-drawer-log-msg">${this.escape(l.message || '')}</span>
      </div>
    `).join('') || '<p class="ep-empty">No matching logs</p>';
  },

  escape(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  },

  copy() {
    const text = this.filtered.map(l =>
      `${l.at || ''}\t${l.type || 'info'}\t${l.message || ''}`
    ).join('\n');
    navigator.clipboard?.writeText(text).then(() => {
      Toast?.success('Logs copied');
    }).catch(() => Toast?.error('Copy failed'));
  },

  export() {
    const text = this.filtered.map(l =>
      `${l.at || ''}\t${l.type || 'info'}\t${l.message || ''}`
    ).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qa-logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    Toast?.success('Logs exported');
  }
};

window.LogsDrawer = LogsDrawer;