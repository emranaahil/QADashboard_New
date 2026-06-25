/**
 * Interval polling that pauses while the browser tab is hidden.
 * Reduces API load when users open multiple tabs or switch away.
 */
export function startVisibleInterval(callback: () => void, ms: number): () => void {
  let id: ReturnType<typeof setInterval> | null = null;

  const tick = () => {
    if (typeof document !== "undefined" && document.hidden) return;
    callback();
  };

  const start = () => {
    if (id !== null) return;
    id = setInterval(tick, ms);
    tick();
  };

  const stop = () => {
    if (id === null) return;
    clearInterval(id);
    id = null;
  };

  const onVisibility = () => {
    if (document.hidden) stop();
    else start();
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) start();
  } else {
    start();
  }

  return () => {
    stop();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}