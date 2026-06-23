/**
 * Enterprise app shell — sidebar + header. Preserves all legacy module routes.
 */
const EnterpriseShell = {
  nav: [
    { href: '/', label: 'Dashboard', icon: '◫' },
    { href: '/ui-testing', label: 'UI Testing', icon: '◎' },
    { href: '/seo-testing', label: 'SEO Testing', icon: '◈' },
    { href: '/keyword-radar', label: 'Keyword Radar', icon: '◉' },
    { href: '/linkradar', label: 'LinkRadar', icon: '◌' },
    { href: '/reports', label: 'Reports', icon: '▤' },
    { href: '/history', label: 'History', icon: '◷' }
  ],

  async mount({ title, subtitle, activePath, contentSelector = '#ep-content' } = {}) {
    document.body.classList.add('ep-theme');

    const root = document.getElementById('ep-root') || document.body;
    const path = activePath || window.location.pathname;

    const navHtml = this.nav.map(n => `
      <a href="${n.href}" ${path === n.href || (n.href !== '/' && path.startsWith(n.href)) ? 'aria-current="page" class="active"' : ''}>
        <span class="ep-nav-icon">${n.icon}</span>
        <span class="ep-nav-label">${n.label}</span>
      </a>
    `).join('');

    const existing = document.getElementById('ep-content');
    const inner = existing ? existing.innerHTML : (contentSelector === '#ep-content' ? '' : document.querySelector(contentSelector)?.innerHTML || '');

    root.innerHTML = `
      <div class="ep-sidebar-backdrop" id="ep-sidebar-backdrop" aria-hidden="true"></div>
      <div class="ep-layout">
        <aside class="ep-sidebar" id="ep-sidebar" aria-label="Main navigation">
          <div class="ep-logo">
            <span class="ep-logo-mark">QA</span>
            <span class="ep-logo-text">QA Dashboard</span>
          </div>
          <nav class="ep-nav">${navHtml}</nav>
        </aside>
        <div class="ep-main">
          <header class="ep-header">
            <div>
              <h1>${title || 'Hi, QA Member'}</h1>
              <p>${subtitle || 'Track quality and release confidence.'}</p>
            </div>
            <div class="ep-header-actions">
              <button class="ep-menu-btn" id="ep-menu-btn" type="button" aria-label="Open navigation menu">☰</button>
              <input type="search" class="ep-search" placeholder="Search..." aria-label="Global search" id="ep-global-search" />
              <button class="ep-btn" id="ep-notifications" type="button" aria-label="Notifications" title="Notifications">🔔</button>
              <span id="ep-exec-status" class="ep-badge ep-badge-idle"><span class="ep-status-dot idle"></span>Idle</span>
              <button class="ep-btn" id="ep-logs-btn" type="button" aria-label="Open logs drawer" title="Logs">≡</button>
              <button class="ep-btn ep-sidebar-toggle-desktop" id="ep-sidebar-toggle" type="button" aria-label="Collapse sidebar">☰</button>
            </div>
          </header>
          <main class="ep-content" id="ep-content">${inner}</main>
        </div>
      </div>
    `;

    const sidebar = document.getElementById('ep-sidebar');
    const backdrop = document.getElementById('ep-sidebar-backdrop');

    const closeMobileSidebar = () => {
      sidebar?.classList.remove('open');
      backdrop?.classList.remove('visible');
    };

    const openMobileSidebar = () => {
      sidebar?.classList.add('open');
      backdrop?.classList.add('visible');
    };

    document.getElementById('ep-menu-btn')?.addEventListener('click', () => {
      if (sidebar?.classList.contains('open')) closeMobileSidebar();
      else openMobileSidebar();
    });

    backdrop?.addEventListener('click', closeMobileSidebar);

    document.getElementById('ep-sidebar-toggle')?.addEventListener('click', () => {
      if (window.matchMedia('(max-width: 1024px)').matches) {
        if (sidebar?.classList.contains('open')) closeMobileSidebar();
        else openMobileSidebar();
      } else {
        sidebar?.classList.toggle('collapsed');
      }
    });

    sidebar?.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        if (window.matchMedia('(max-width: 1024px)').matches) closeMobileSidebar();
      });
    });

    if (typeof Toast !== 'undefined') Toast.init();
    if (typeof LogsDrawer !== 'undefined') LogsDrawer.init();

    document.getElementById('ep-logs-btn')?.addEventListener('click', () => {
      if (typeof LogsDrawer !== 'undefined') LogsDrawer.open([]);
    });

    document.getElementById('ep-global-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = e.target.value.trim();
        if (q) window.location.href = `/history?q=${encodeURIComponent(q)}`;
      }
    });

    return document.getElementById('ep-content');
  },

  setExecutionStatus(state) {
    const el = document.getElementById('ep-exec-status');
    if (!el) return;
    const map = {
      idle: { cls: 'ep-badge-idle', dot: 'idle', label: 'Idle' },
      running: { cls: 'ep-badge-running', dot: 'running', label: 'Running' },
      success: { cls: 'ep-badge-success', dot: 'success', label: 'Success' },
      failed: { cls: 'ep-badge-failed', dot: 'failed', label: 'Failed' }
    };
    const s = map[state] || map.idle;
    el.className = `ep-badge ${s.cls}`;
    el.innerHTML = `<span class="ep-status-dot ${s.dot}"></span>${s.label}`;
  }
};

window.EnterpriseShell = EnterpriseShell;