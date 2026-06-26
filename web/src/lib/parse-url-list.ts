import { MAX_URL_LENGTH, normalizeUrl, validateUrl } from "@/lib/url-validation";

export const MAX_URLS_PER_RUN = 20;

export type ParsedUrlList = {
  primaryUrl: string;
  urls: string[];
};

/** Parse comma-separated URLs for single-page multi-URL runs. */
export function parseUrlListInput(value: string): ParsedUrlList {
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
  if (parts.length > MAX_URLS_PER_RUN) {
    throw new Error(`Maximum ${MAX_URLS_PER_RUN} URLs allowed per run`);
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

  return { primaryUrl: urls[0], urls };
}

/** Returns error message or null if valid (single or comma-separated). */
export function validateUrlListInput(value: string): string | null {
  const raw = value.trim();
  if (!raw) return "URL is required";
  if (raw.length > MAX_URL_LENGTH) {
    return `URL input must be ${MAX_URL_LENGTH} characters or less`;
  }

  try {
    parseUrlListInput(raw);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid URL list";
  }
}