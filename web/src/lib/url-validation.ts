export const MAX_URL_LENGTH = 2048;
export const MAX_KEYWORD_LENGTH = 200;
export const MAX_KEYWORDS = 50;

const INVALID_URL_CHARS = /[\s<>"'`\\^{|}]/;
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/i;

export function normalizeUrl(value: string): string {
  let url = value.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    let clean = parsed.toString();
    if (clean.endsWith("/") && clean.length > parsed.origin.length + 1) {
      clean = clean.slice(0, -1);
    }
    return clean;
  } catch {
    return url;
  }
}

function isValidHostname(host: string): boolean {
  const hostname = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname.length > 253) return false;
  if (hostname === "localhost") return true;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    const parts = hostname.split(".").map(Number);
    return parts.every((p) => p >= 0 && p <= 255);
  }
  if (hostname.includes(":")) return true;
  return HOSTNAME_RE.test(hostname) && hostname.includes(".");
}

export function isValidUrl(value: string): boolean {
  return validateUrl(value) === null;
}

/** Returns error message or null if valid */
export function validateUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "URL is required";
  if (trimmed.length > MAX_URL_LENGTH) {
    return `URL must be ${MAX_URL_LENGTH} characters or less`;
  }
  if (INVALID_URL_CHARS.test(trimmed)) {
    return "URL contains invalid characters";
  }
  if (/^javascript:/i.test(trimmed) || /^data:/i.test(trimmed) || /^file:/i.test(trimmed)) {
    return "Only HTTP and HTTPS URLs are allowed";
  }

  const clean = normalizeUrl(trimmed);
  if (!clean) return "URL is required";

  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    return "Invalid URL format";
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Only HTTP and HTTPS URLs are allowed";
  }
  if (parsed.username || parsed.password) {
    return "URL must not include username or password";
  }
  if (!isValidHostname(parsed.hostname)) {
    return "Invalid hostname";
  }
  if (parsed.href.length > MAX_URL_LENGTH) {
    return `URL must be ${MAX_URL_LENGTH} characters or less`;
  }

  return null;
}

function parseKeywordLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((k) => k.trim())
    .filter(Boolean);
}

function validateKeywordList(keywords: string[], label = "keyword"): string | null {
  if (keywords.length > MAX_KEYWORDS) {
    return `Maximum ${MAX_KEYWORDS} ${label}s allowed`;
  }
  for (const kw of keywords) {
    if (kw.length > MAX_KEYWORD_LENGTH) {
      return `Each ${label} must be ${MAX_KEYWORD_LENGTH} characters or less`;
    }
  }
  return null;
}

export function validateKeywords(raw: string): { keywords: string[]; error: string | null } {
  const keywords = parseKeywordLines(raw);

  if (!keywords.length) {
    return { keywords: [], error: "Enter at least one keyword" };
  }
  const listError = validateKeywordList(keywords);
  if (listError) {
    return { keywords: [], error: listError };
  }
  return { keywords, error: null };
}

/** Optional case-sensitive keywords — empty input is valid. */
export function validateOptionalKeywords(raw: string): { keywords: string[]; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { keywords: [], error: null };
  }
  const keywords = parseKeywordLines(raw);
  const listError = validateKeywordList(keywords, "case-sensitive keyword");
  if (listError) {
    return { keywords: [], error: listError };
  }
  return { keywords, error: null };
}

export function validateKeywordScanInput(
  keywordsText: string,
  caseSensitiveKeywordsText: string
): {
  keywords: string[];
  caseSensitiveKeywords: string[];
  error: string | null;
} {
  const { keywords: caseSensitiveKeywords, error: csError } =
    validateOptionalKeywords(caseSensitiveKeywordsText);
  if (csError) {
    return { keywords: [], caseSensitiveKeywords: [], error: csError };
  }

  let keywords: string[] = [];
  if (keywordsText.trim()) {
    const standard = validateKeywords(keywordsText);
    if (standard.error) {
      return { keywords: [], caseSensitiveKeywords: [], error: standard.error };
    }
    keywords = standard.keywords;
  }

  if (!keywords.length && !caseSensitiveKeywords.length) {
    return {
      keywords: [],
      caseSensitiveKeywords: [],
      error: "Enter at least one keyword (standard or case-sensitive)",
    };
  }
  if (keywords.length + caseSensitiveKeywords.length > MAX_KEYWORDS) {
    return {
      keywords: [],
      caseSensitiveKeywords: [],
      error: `Maximum ${MAX_KEYWORDS} keywords total (standard + case-sensitive)`,
    };
  }

  return { keywords, caseSensitiveKeywords, error: null };
}