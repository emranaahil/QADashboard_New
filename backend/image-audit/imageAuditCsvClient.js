/**
 * Browser-side CSV export for embedded Image Audit HTML reports.
 * Expects window.IMAGE_AUDIT_DATA = { domain, images, viewports, ... }.
 */
(function () {
  var CSV_BOM = '\uFEFF';

  var BASE_HEADERS = [
    'No.',
    'Page URL',
    'Image Type',
    'Image URL',
    'Alt Text',
    'Original Width',
    'Original Height'
  ];

  var TAIL_HEADERS = [
    'Loading Status',
    'HTTP Status',
    'File Size',
    'Responsive',
    'Loaded',
    'Broken'
  ];

  function viewportCsvHeaderCells(viewport) {
    var label = viewport.label;
    return [
      label + ' W',
      label + ' H',
      label + ' W Δ%',
      label + ' H Δ%',
      'Visible (' + label + ')',
      'Optimization (' + label + ')'
    ];
  }

  function resolveViewports(report) {
    if (report && Array.isArray(report.viewports) && report.viewports.length) {
      return report.viewports;
    }
    return [{ key: '1920x1080', label: '1920×1080' }];
  }

  function buildHeaders(viewports) {
    return BASE_HEADERS.concat(
      viewports.reduce(function (acc, vp) {
        return acc.concat(viewportCsvHeaderCells(vp));
      }, []),
      TAIL_HEADERS
    );
  }

  function csvEscape(value) {
    return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
  }

  function getViewportSlot(img, key) {
    var slot = img.rendering && img.rendering.viewports && img.rendering.viewports[key];
    if (slot) return slot;
    return {
      renderedWidth: 0,
      renderedHeight: 0,
      visible: false,
      widthDiffPct: '',
      heightDiffPct: '',
      currentSrc: '',
      optimization: { issues: [], recommendations: [] }
    };
  }

  function formatDiffPct(pct) {
    if (pct === '' || pct == null) return '';
    var n = Number(pct);
    if (!isFinite(n) || n <= 0) return '';
    return String(n) + '%';
  }

  function loadingStatus(img) {
    if (img.source && img.source.loading) return String(img.source.loading);
    if (img.source && img.source.lazy) return 'lazy';
    return 'eager';
  }

  function optimizationStatusForViewport(img, viewportKey) {
    var slot = getViewportSlot(img, viewportKey);
    var issues = (slot.optimization && slot.optimization.issues) || [];
    if (!issues.length) return 'OK';
    var recs = (slot.optimization && slot.optimization.recommendations) || [];
    return recs.length ? issues.join('; ') + ' → ' + recs.join('; ') : issues.join('; ');
  }

  function visibleLabel(slot) {
    return slot.visible ? 'Yes' : 'No';
  }

  function viewportCsvCells(img, viewportKey) {
    var slot = getViewportSlot(img, viewportKey);
    return [
      slot.renderedWidth != null ? slot.renderedWidth : 0,
      slot.renderedHeight != null ? slot.renderedHeight : 0,
      formatDiffPct(slot.widthDiffPct),
      formatDiffPct(slot.heightDiffPct),
      visibleLabel(slot),
      optimizationStatusForViewport(img, viewportKey)
    ];
  }

  function loadedStatus(img) {
    if (img.verification && img.verification.broken) return 'No';
    if (img.verification && img.verification.ok) return 'Yes';
    return 'Unknown';
  }

  function formatBytes(n) {
    if (!n) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function imageToRow(img, index, viewports) {
    var viewportCells = viewports.reduce(function (acc, vp) {
      return acc.concat(viewportCsvCells(img, vp.key));
    }, []);
    return [
      index + 1,
      img.identity && img.identity.pageUrl,
      img.metadata && img.metadata.format,
      img.identity && img.identity.url,
      img.accessibility && img.accessibility.alt != null ? img.accessibility.alt : '',
      img.rendering && img.rendering.naturalWidth != null ? img.rendering.naturalWidth : '',
      img.rendering && img.rendering.naturalHeight != null ? img.rendering.naturalHeight : ''
    ]
      .concat(viewportCells)
      .concat([
        loadingStatus(img),
        img.network && img.network.status != null ? img.network.status : '',
        img.network && img.network.bytes != null ? formatBytes(img.network.bytes) : '',
        img.source && img.source.responsive ? 'Yes' : 'No',
        loadedStatus(img),
        img.verification && img.verification.broken ? 'Yes' : 'No'
      ])
      .map(csvEscape)
      .join(',');
  }

  function csvFilename(domain) {
    var safe = String(domain || 'site').replace(/[^a-z0-9.-]+/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'site';
    return 'Image_Audit_' + safe + '.csv';
  }

  function downloadCsv(filename, content) {
    var blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  window.exportImageAuditCsv = function () {
    var report = window.IMAGE_AUDIT_DATA;
    if (!report || !report.images || !report.images.length) {
      alert('No report data available for CSV export.');
      return;
    }
    var viewports = resolveViewports(report);
    var headers = buildHeaders(viewports);
    var lines = [headers.map(csvEscape).join(',')];
    report.images.forEach(function (img, idx) {
      lines.push(imageToRow(img, idx, viewports));
    });
    var csv = CSV_BOM + lines.join('\r\n') + '\r\n';
    downloadCsv(csvFilename(report.domain), csv);
  };

  function bindImageAuditActions() {
    document.addEventListener('click', function (event) {
      var btn = event.target && event.target.closest && event.target.closest('[data-image-audit-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-image-audit-action');
      if (action === 'export-csv') {
        event.preventDefault();
        window.exportImageAuditCsv();
      } else if (action === 'print') {
        event.preventDefault();
        window.print();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindImageAuditActions);
  } else {
    bindImageAuditActions();
  }
})();
