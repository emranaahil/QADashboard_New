import { normalizeUrl, validateUrl } from "@/lib/url-validation";

export type ParseUrlListOptions = {
  /** When set, caps how many comma-separated URLs are accepted. */
  maxUrls?: number;
  /** When set, caps total pasted input length. Omit for unlimited bulk paste. */
  maxInputLength?: number;
};

export type ParsedUrlList = {
  primaryUrl: string;
  urls: string[];
};

/** Parse comma-separated URLs for single-page multi-URL runs. */
export function parseUrlListInput(value: string, options: ParseUrlListOptions = {}): ParsedUrlList {
  const raw = value.trim();
  if (!raw) {
    throw new Error("URL is required");
  }

  const parts = raw.includes(",")
    ? raw.split(",").map((s) => s.trim()).filter(Boolean)
    : [raw];

  if (!parts.length) {
    throw new Error("URL is required");
  }
  if (options.maxUrls != null && options.maxUrls > 0 && parts.length > options.maxUrls) {
    throw new Error(`Maximum ${options.maxUrls} URLs allowed per run`);
  }

  const urls: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const err = validateUrl(part);
    if (err) throw new Error(err);
    const clean = normalizeUrl(part);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    urls.push(clean);
  }

  if (!urls.length) {
    throw new Error("URL is required");
  }
  if (options.maxUrls != null && options.maxUrls > 0 && urls.length > options.maxUrls) {
    throw new Error(`Maximum ${options.maxUrls} URLs allowed per run`);
  }

  return { primaryUrl: urls[0], urls };
}

/** Returns error message or null if valid (single or comma-separated). */
export function validateUrlListInput(value: string, options: ParseUrlListOptions = {}): string | null {
  const raw = value.trim();
  if (!raw) return "URL is required";

  if (options.maxInputLength != null && raw.length > options.maxInputLength) {
    return `URL input must be ${options.maxInputLength} characters or less`;
  }

  try {
    parseUrlListInput(raw, options);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid URL list";
  }
}