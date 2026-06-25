import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function truncateUrl(url: string, max = 48) {
  if (!url || url.length <= max) return url;
  return url.slice(0, max - 3) + "...";
}

export function formatDateTime(
  value?: string | Date | null,
  opts?: { dateOnly?: boolean }
): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();

  if (opts?.dateOnly) return `${dd}/${mm}/${yyyy}`;

  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy}, ${hh}:${min}`;
}

export function deriveModelId(url: string) {
  if (!url) return null;
  try {
    let clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) clean = `https://${clean}`;
    return new URL(clean).hostname.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
  } catch {
    return null;
  }
}