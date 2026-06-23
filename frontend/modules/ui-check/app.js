document.addEventListener('DOMContentLoaded', async () => {
  await AppShell.init('ui-check');

  window.__jobRunner = new JobRunner({ moduleId: 'ui-check' });
  await window.__jobRunner.init();

  const panel = new ReportPanel({
    moduleId: 'ui-check',
    listEl: document.getElementById('report-list'),
    viewerEl: document.getElementById('report-viewer'),
    actionsEl: document.getElementById('report-actions'),
    onRender: renderUiCheckReport
  });
  document.addEventListener('qa:job-completed', (e) => {
    if (e.detail?.moduleId === 'ui-check') panel.load();
  });
  await panel.load();
});