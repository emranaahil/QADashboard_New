const STORAGE_KEY = "qa_session_id";
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;

function createSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function syncSessionCookie(sessionId: string) {
  if (typeof document === "undefined") return;
  document.cookie = `qa_session_id=${encodeURIComponent(sessionId)}; path=/; max-age=${COOKIE_MAX_AGE_SEC}; SameSite=Lax`;
}

/** Stable anonymous session per browser — used to isolate live runs on shared Render deploys. */
export function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "";

  let sessionId = localStorage.getItem(STORAGE_KEY);
  if (!sessionId) {
    sessionId = createSessionId();
    localStorage.setItem(STORAGE_KEY, sessionId);
  }
  syncSessionCookie(sessionId);
  return sessionId;
}

export function getSessionHeaders(): Record<string, string> {
  const sessionId = getOrCreateSessionId();
  if (!sessionId) return {};
  return { "X-QA-Session-Id": sessionId };
}

export function withSessionQuery(url: string): string {
  const sessionId = getOrCreateSessionId();
  if (!sessionId) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}qaSession=${encodeURIComponent(sessionId)}`;
}