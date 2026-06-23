document.addEventListener('DOMContentLoaded', async () => {
  await AppShell.init('seo');

  window.__jobRunner = new JobRunner({ moduleId: 'seo' });
  await window.__jobRunner.init();

  const panel = new ReportPanel({
    moduleId: 'seo',
    listEl: document.getElementById('report-list'),
    viewerEl: document.getElementById('report-viewer'),
    actionsEl: document.getElementById('report-actions'),
    onRender: renderSeoReport
  });
  document.addEventListener('qa:job-completed', (e) => {
    if (e.detail?.moduleId === 'seo') panel.load();
  });
  await panel.load();
});