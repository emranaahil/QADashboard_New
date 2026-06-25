"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/utils";

type Health = {
  status?: string;
  startedAt?: string;
  ui?: string;
  mode?: string;
};

export function ApiDevStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const retryDelays = [0, 2000, 4000, 8000];

    const poll = async () => {
      try {
        const data = await api.health();
        if (!cancelled) {
          setHealth(data as Health);
          setReachable(true);
        }
        return true;
      } catch {
        if (!cancelled) {
          setHealth(null);
          setReachable(false);
        }
        return false;
      }
    };

    (async () => {
      for (const delay of retryDelays) {
        if (cancelled) return;
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        if (await poll()) return;
      }
    })();

    const id = setInterval(poll, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (process.env.NODE_ENV === "production") return null;

  const startedLabel = health?.startedAt ? formatDateTime(health.startedAt) : null;

  return (
    <div
      className={cn(
        "hidden items-center gap-2 rounded-full border px-2.5 py-1 text-[0.65rem] font-medium sm:flex",
        reachable
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          : "border-destructive/40 bg-destructive/10 text-destructive"
      )}
      title={
        reachable
          ? `API connected · started ${health?.startedAt || "unknown"} · UI http://localhost:3001`
          : "API not reachable. Run: npm run dev:restart"
      }
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", reachable ? "bg-emerald-400" : "bg-destructive")} />
      {reachable ? `Dev API${startedLabel ? ` · ${startedLabel}` : ""}` : "API offline"}
    </div>
  );
}