import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function truncateUrl(url: string, max = 48) {
  if (!url || url.length <= max) return url;
  return url.slice(0, max - 3) + "...";
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