/**
 * Renders shared navigation shell. Reads module list from API — no hardcoded modules.
 */
const AppShell = {
  async init(moduleId) {
    const container = document.getElementById('app-shell');
    if (!container) return;

    let modules = [];
    try {
      const data = await ModuleAPI.listModules();
      modules = data.modules || [];
    } catch {
      container.innerHTML = '<div class="shell-inner"><span>QA Toolkit</span></div>';
      return;
    }

    const current = modules.find(m => m.id === moduleId);
    const navLinks = modules.map(m =>
      `<a href="${m.route}" class="${m.id === moduleId ? 'active' : ''}">${m.icon} ${m.name}</a>`
    ).join('');

    container.innerHTML = `
      <div class="shell-inner">
        <div class="shell-top">
          <div class="shell-brand"><a href="/">🏠 QA Toolkit</a></div>
          <nav class="shell-nav">${navLinks}</nav>
        </div>
        ${current ? `
          <div class="module-header">
            <h1>${current.icon} ${current.name}</h1>
            <p>${current.description}</p>
          </div>
        ` : ''}
      </div>
    `;
  }
};

window.AppShell = AppShell;