"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function ApiBanner() {
  const [ok, setOk] = useState(true);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        await api.health();
        if (alive) setOk(true);
      } catch {
        if (alive) setOk(false);
      } finally {
        if (alive) setChecked(true);
      }
    };
    check();
    const t = setInterval(check, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!checked || ok) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-center text-xs text-amber-200">
      API offline — run <code className="rounded bg-black/30 px-1">npm run dev</code> in project root (port 3000)
    </div>
  );
}