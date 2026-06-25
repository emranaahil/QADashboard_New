function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderLogHtml({ title, subtitle, lines = [], meta = {}, autoRefreshSec = 0 }) {
  const metaRows = Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
    .join('');

  const body = lines.length
    ? lines.map((line) => `<div class="line">${escapeHtml(line)}</div>`).join('')
    : '<div class="empty">No log lines recorded for this execution.</div>';

  const refreshTag = autoRefreshSec > 0
    ? `<meta http-equiv="refresh" content="${autoRefreshSec}" />`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${refreshTag}
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #0b1220; color: #e2e8f0; }
    header { padding: 20px 24px; border-bottom: 1px solid #1e293b; background: #111827; }
    h1 { margin: 0 0 6px; font-size: 18px; font-family: system-ui, sans-serif; }
    p { margin: 0; color: #94a3b8; font-size: 13px; font-family: system-ui, sans-serif; }
    table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 12px; font-family: system-ui, sans-serif; }
    th { text-align: left; color: #94a3b8; padding: 4px 10px 4px 0; width: 120px; vertical-align: top; }
    td { padding: 4px 0; word-break: break-word; }
    main { padding: 16px 24px 32px; }
    .line { padding: 6px 0; border-bottom: 1px solid rgba(30,41,59,.65); white-space: pre-wrap; word-break: break-word; }
    .line:last-child { border-bottom: 0; }
    .empty { color: #94a3b8; font-family: system-ui, sans-serif; }
    .error { color: #fca5a5; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
    ${metaRows ? `<table>${metaRows}</table>` : ''}
  </header>
  <main>${body}</main>
  <script>
    window.addEventListener('load', function () {
      window.scrollTo(0, document.body.scrollHeight);
    });
  </script>
</body>
</html>`;
}

module.exports = { renderLogHtml, escapeHtml };