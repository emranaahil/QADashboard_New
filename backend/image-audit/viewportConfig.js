/** Default desktop viewport when the client does not specify any. */
const DEFAULT_AUDIT_VIEWPORTS = [
  { key: '1920x1080', label: '1920×1080', width: 1920, height: 1080 }
];

/** @deprecated Use DEFAULT_AUDIT_VIEWPORTS or resolveAuditViewports() */
const AUDIT_VIEWPORTS = DEFAULT_AUDIT_VIEWPORTS;

const VIEWPORT_COLUMN_COUNT = 6;
const MAX_AUDIT_VIEWPORTS = 5;
const MIN_VIEWPORT_DIMENSION = 1;
const MAX_VIEWPORT_DIMENSION = 3840;

function buildViewportKey(width, height) {
  return `${width}x${height}`;
}

function buildViewportLabel(width, height) {
  return `${width}×${height}`;
}

function normalizeViewportEntry(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;

  let width = Number(raw.width);
  let height = Number(raw.height);

  if ((!Number.isFinite(width) || !Number.isFinite(height)) && typeof raw.key === 'string') {
    const match = raw.key.match(/^(\d+)x(\d+)$/i);
    if (match) {
      width = Number(match[1]);
      height = Number(match[2]);
    }
  }

  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  width = Math.round(width);
  height = Math.round(height);
  if (
    width < MIN_VIEWPORT_DIMENSION ||
    height < MIN_VIEWPORT_DIMENSION ||
    width > MAX_VIEWPORT_DIMENSION ||
    height > MAX_VIEWPORT_DIMENSION
  ) {
    return null;
  }

  const key = String(raw.key || buildViewportKey(width, height)).toLowerCase();
  const label = String(raw.label || buildViewportLabel(width, height)).trim() || buildViewportLabel(width, height);

  return { key, label, width, height, _index: index };
}

function dedupeViewports(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || seen.has(item.key)) continue;
    seen.add(item.key);
    const { _index, ...vp } = item;
    out.push(vp);
  }
  return out;
}

/**
 * Parse user-supplied viewports from job options.
 * Accepts [{ width, height, label?, key? }] or "1920x1080" strings.
 */
function parseAuditViewports(input) {
  if (!input) return [];

  const items = Array.isArray(input) ? input : [input];
  const parsed = [];

  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    if (typeof raw === 'string') {
      const match = raw.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
      if (match) {
        parsed.push(
          normalizeViewportEntry(
            {
              width: Number(match[1]),
              height: Number(match[2])
            },
            i
          )
        );
      }
      continue;
    }
    parsed.push(normalizeViewportEntry(raw, i));
  }

  return dedupeViewports(parsed.filter(Boolean));
}

/**
 * Resolve viewports for a job/report — falls back to default when omitted.
 */
function resolveAuditViewports(options = {}) {
  const fromOptions = parseAuditViewports(options.viewports);
  if (fromOptions.length) {
    if (fromOptions.length > MAX_AUDIT_VIEWPORTS) {
      throw new Error(`Maximum ${MAX_AUDIT_VIEWPORTS} viewports allowed`);
    }
    return fromOptions;
  }

  const fromReport = parseAuditViewports(options.report?.viewports);
  if (fromReport.length) return fromReport;

  return DEFAULT_AUDIT_VIEWPORTS.map((vp) => ({ ...vp }));
}

function emptyViewportSlot(viewport) {
  return {
    label: viewport.label,
    width: viewport.width,
    height: viewport.height,
    renderedWidth: 0,
    renderedHeight: 0,
    visible: false,
    widthDiffPct: '',
    heightDiffPct: '',
    currentSrc: '',
    optimization: { issues: [], recommendations: [], potentialSavingsBytes: 0 }
  };
}

function initViewportMap(viewports = DEFAULT_AUDIT_VIEWPORTS) {
  const map = {};
  for (const vp of viewports) {
    map[vp.key] = emptyViewportSlot(vp);
  }
  return map;
}

function getViewportSlot(img, key, viewports = DEFAULT_AUDIT_VIEWPORTS) {
  const slot = img?.rendering?.viewports?.[key];
  if (slot) return slot;
  const vp = viewports.find((v) => v.key === key);
  return vp ? emptyViewportSlot(vp) : emptyViewportSlot(viewports[0] || DEFAULT_AUDIT_VIEWPORTS[0]);
}

/** (original − rendered) ÷ original × 100 — only positive when file is larger than on-screen display. */
function computeDiffPct(rendered, original) {
  const r = Number(rendered);
  const o = Number(original);
  if (!Number.isFinite(r) || !Number.isFinite(o) || r <= 0 || o <= 0) return '';
  const pct = Math.round(((o - r) / o) * 100);
  if (pct <= 0) return '';
  return String(pct);
}

function formatDiffPct(pct) {
  if (pct === '' || pct == null) return '';
  const n = Number(pct);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${n}%`;
}

function viewportCsvHeaderCells(viewport) {
  const label = viewport.label;
  return [
    `${label} W`,
    `${label} H`,
    `${label} W Δ%`,
    `${label} H Δ%`,
    `Visible (${label})`,
    `Optimization (${label})`
  ];
}

function viewportSummaryLine(viewports) {
  return (viewports || DEFAULT_AUDIT_VIEWPORTS)
    .map((vp) => vp.label || buildViewportLabel(vp.width, vp.height))
    .join(' · ');
}

module.exports = {
  DEFAULT_AUDIT_VIEWPORTS,
  AUDIT_VIEWPORTS,
  VIEWPORT_COLUMN_COUNT,
  MAX_AUDIT_VIEWPORTS,
  MIN_VIEWPORT_DIMENSION,
  MAX_VIEWPORT_DIMENSION,
  buildViewportKey,
  buildViewportLabel,
  parseAuditViewports,
  resolveAuditViewports,
  emptyViewportSlot,
  initViewportMap,
  getViewportSlot,
  computeDiffPct,
  formatDiffPct,
  viewportCsvHeaderCells,
  viewportSummaryLine
};