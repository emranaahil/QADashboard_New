document.addEventListener('DOMContentLoaded', async () => {
  await AppShell.init('full-ui-check');

  window.__jobRunner = new JobRunner({ moduleId: 'full-ui-check' });
  await window.__jobRunner.init();

  const panel = new ReportPanel({
    moduleId: 'full-ui-check',
    listEl: document.getElementById('report-list'),
    viewerEl: document.getElementById('report-viewer'),
    actionsEl: document.getElementById('report-actions'),
    onRender: renderFullUiReport
  });
  document.addEventListener('qa:job-completed', (e) => {
    if (e.detail?.moduleId === 'full-ui-check') panel.load();
  });
  await panel.load();
});