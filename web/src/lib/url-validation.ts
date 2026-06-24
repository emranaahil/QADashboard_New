export function normalizeUrl(value: string): string {
  let url = value.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (url.endsWith("/") && url.length > 8) url = url.slice(0, -1);
  return url;
}

export function isValidUrl(value: string): boolean {
  const clean = normalizeUrl(value);
  if (!clean) return false;
  try {
    const parsed = new URL(clean);
    const host = parsed.hostname;
    const isLocalhost = host === "localhost";
    const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
    return isLocalhost || isIp || host.includes(".");
  } catch {
    return false;
  }
}

/** Returns error message or null if valid */
export function validateUrl(value: string): string | null {
  if (!value.trim()) return "URL is required";
  if (!isValidUrl(value)) return "Invalid URL";
  return null;
}