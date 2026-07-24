export type AuditViewport = {
  key: string;
  label: string;
  width: number;
  height: number;
};

export const MAX_AUDIT_VIEWPORTS = 5;
export const MIN_VIEWPORT_DIMENSION = 1;
export const MAX_VIEWPORT_DIMENSION = 3840;

export const VIEWPORT_PRESETS: AuditViewport[] = [
  { key: "1920x1080", label: "1920×1080", width: 1920, height: 1080 },
  { key: "1440x900", label: "1440×900", width: 1440, height: 900 },
  { key: "1366x768", label: "1366×768", width: 1366, height: 768 },
  { key: "390x844", label: "390×844", width: 390, height: 844 },
  { key: "768x1024", label: "768×1024", width: 768, height: 1024 },
];

export const DEFAULT_SELECTED_VIEWPORT_KEYS = ["1920x1080"];

export function buildViewportKey(width: number, height: number): string {
  return `${width}x${height}`;
}

export function buildViewportLabel(width: number, height: number): string {
  return `${width}×${height}`;
}

export function parseCustomViewport(
  widthInput: string,
  heightInput: string,
  labelInput?: string
): AuditViewport | null {
  const width = Number(widthInput);
  const height = Number(heightInput);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < MIN_VIEWPORT_DIMENSION ||
    height < MIN_VIEWPORT_DIMENSION ||
    width > MAX_VIEWPORT_DIMENSION ||
    height > MAX_VIEWPORT_DIMENSION
  ) {
    return null;
  }

  const roundedWidth = Math.round(width);
  const roundedHeight = Math.round(height);
  const label = (labelInput || "").trim() || buildViewportLabel(roundedWidth, roundedHeight);

  return {
    key: buildViewportKey(roundedWidth, roundedHeight),
    label,
    width: roundedWidth,
    height: roundedHeight,
  };
}

function dedupeViewports(viewports: AuditViewport[]): AuditViewport[] {
  const seen = new Set<string>();
  const out: AuditViewport[] = [];
  for (const vp of viewports) {
    if (seen.has(vp.key)) continue;
    seen.add(vp.key);
    out.push(vp);
  }
  return out;
}

export function collectViewportsForRun(
  selectedKeys: string[],
  customViewports: AuditViewport[],
  pending?: AuditViewport | null
): AuditViewport[] {
  const presetMap = new Map(VIEWPORT_PRESETS.map((vp) => [vp.key, vp]));
  const selected = selectedKeys
    .map((key) => presetMap.get(key))
    .filter((vp): vp is AuditViewport => Boolean(vp));

  const items = [...selected, ...customViewports];
  if (pending) items.push(pending);
  return dedupeViewports(items);
}

export function validateViewportsForRun(viewports: AuditViewport[]): string | null {
  if (!viewports.length) {
    return "Select at least one viewport";
  }
  if (viewports.length > MAX_AUDIT_VIEWPORTS) {
    return `Maximum ${MAX_AUDIT_VIEWPORTS} viewports allowed`;
  }
  return null;
}

export function serializeViewportsForApi(viewports: AuditViewport[]) {
  return viewports.map((vp) => ({
    key: vp.key,
    label: vp.label,
    width: vp.width,
    height: vp.height,
  }));
}