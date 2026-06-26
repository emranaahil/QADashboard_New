"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const RETRY_DELAYS_MS = [0, 2000, 4000, 8000];
const IS_DEV = process.env.NODE_ENV !== "production";

export function ApiBanner() {
  const [ok, setOk] = useState(true);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!IS_DEV) return;
    let alive = true;

    const check = async () => {
      try {
        await api.health();
        if (alive) {
          setOk(true);
          setChecked(true);
        }
        return true;
      } catch {
        if (alive) setOk(false);
        return false;
      }
    };

    (async () => {
      for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
        if (!alive) return;
        if (RETRY_DELAYS_MS[i] > 0) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]));
        }
        if (!alive) return;
        const success = await check();
        if (success) return;
      }
      if (alive) setChecked(true);
    })();

    const t = setInterval(async () => {
      const success = await check();
      if (alive && success) setChecked(true);
    }, 30000);

    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!IS_DEV || !checked || ok) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-center text-xs text-amber-200">
      API offline — from the project root run{" "}
      <code className="rounded bg-black/30 px-1">npm run dev</code> (API :3000 + UI :3001). Open{" "}
      <a href="http://localhost:3001" className="underline">
        localhost:3001
      </a>
      , not port 3000 alone.
    </div>
  );
}